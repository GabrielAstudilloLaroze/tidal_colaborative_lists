import os
import json
import datetime
import threading
from flask import Flask, jsonify, request, render_template, send_from_directory
import tidalapi

app = Flask(__name__, static_folder='static', template_folder='templates')

SESSION_FILE = os.path.expanduser('~/colabList/.tidal_session.json')
session_lock = threading.Lock()

# Global Tidal Session
session = tidalapi.Session()

# OAuth State
login_obj = None
login_future = None

def save_session(sess):
    with session_lock:
        try:
            # Ensure the directory exists
            os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
            
            expiry = sess.expiry_time
            if isinstance(expiry, datetime.datetime):
                expiry_str = expiry.isoformat()
            else:
                expiry_str = expiry
                
            creds = {
                'token_type': sess.token_type,
                'access_token': sess.access_token,
                'refresh_token': sess.refresh_token,
                'expiry_time': expiry_str
            }
            with open(SESSION_FILE, 'w') as f:
                json.dump(creds, f)
            print("Tidal session saved successfully.")
        except Exception as e:
            print(f"Error saving Tidal session: {e}")

def load_session(sess):
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, 'r') as f:
                creds = json.load(f)
            
            expiry_val = creds.get('expiry_time')
            if expiry_val:
                try:
                    expiry_val = datetime.datetime.fromisoformat(expiry_val)
                except Exception:
                    pass
            
            sess.load_oauth_session(
                token_type=creds['token_type'],
                access_token=creds['access_token'],
                refresh_token=creds['refresh_token'],
                expiry_time=expiry_val
            )
            
            # Check if login is valid or needs refresh
            if sess.check_login():
                print("Tidal session restored and verified.")
                return True
            else:
                print("Restored session is not logged in. Attempting refresh...")
                # python-tidal automatically tries to refresh if possible, but let's double check
                if sess.check_login():
                    save_session(sess)
                    return True
        except Exception as e:
            print(f"Error loading Tidal session: {e}")
    return False

# Attempt to load session at startup
load_session(session)

def check_login_future_loop(future, sess):
    try:
        # Blocks until login completes or fails
        future.result()
        if sess.check_login():
            save_session(sess)
            print("Device login successful!")
        else:
            print("Device login completed but check_login failed.")
    except Exception as e:
        print(f"Error in login future: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    global login_obj, login_future
    
    # Check if currently authenticated
    is_authenticated = False
    try:
        is_authenticated = session.check_login()
    except Exception as e:
        print(f"Error checking login status: {e}")
        
    if is_authenticated:
        try:
            user_id = session.user.id if session.user else None
            user_name = session.user.name if session.user else "Tidal User"
            return jsonify({
                "status": "authenticated",
                "user": {
                    "id": user_id,
                    "name": user_name
                }
            })
        except Exception as e:
            print(f"Error fetching user details: {e}")
            return jsonify({
                "status": "authenticated",
                "user": {
                    "id": None,
                    "name": "Authenticated User"
                }
            })
            
    # Check if login is in progress
    if login_future is not None and not login_future.done():
        return jsonify({
            "status": "pending",
            "verification_uri": login_obj.verification_uri_complete,
            "user_code": login_obj.user_code
        })
        
    return jsonify({
        "status": "unauthenticated"
    })

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    global login_obj, login_future
    
    # If already logged in, return success
    try:
        if session.check_login():
            return jsonify({"status": "authenticated"})
    except Exception:
        pass
        
    # Start OAuth login
    try:
        login_obj, login_future = session.login_oauth()
        # Start a thread to watch the login completion and save to disk
        threading.Thread(target=check_login_future_loop, args=(login_future, session), daemon=True).start()
        
        return jsonify({
            "status": "pending",
            "verification_uri": login_obj.verification_uri_complete,
            "user_code": login_obj.user_code
        })
    except Exception as e:
        return jsonify({"error": f"Failed to start login: {str(e)}"}), 500

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    global login_obj, login_future, session
    try:
        if os.path.exists(SESSION_FILE):
            os.remove(SESSION_FILE)
    except Exception as e:
        print(f"Error removing session file: {e}")
        
    # Reset Session
    session = tidalapi.Session()
    login_obj = None
    login_future = None
    
    return jsonify({"status": "unauthenticated"})

@app.route('/api/playlists', methods=['GET'])
def get_playlists():
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        playlists = session.user.playlists()
        result = []
        for p in playlists:
            result.append({
                "id": p.id,
                "name": p.name,
                "num_tracks": getattr(p, 'num_tracks', 0),
                "description": getattr(p, 'description', '')
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/create', methods=['POST'])
def create_playlist():
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        data = request.json or {}
        name = data.get('name', 'Collaborative Playlist')
        description = data.get('description', 'Created via colabList')
        
        playlist = session.user.create_playlist(name, description)
        return jsonify({
            "id": playlist.id,
            "name": playlist.name,
            "description": getattr(playlist, 'description', '')
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/<playlist_id>', methods=['GET'])
def get_playlist_details(playlist_id):
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        playlist = session.playlist(playlist_id)
        return jsonify({
            "id": playlist.id,
            "name": playlist.name,
            "num_tracks": getattr(playlist, 'num_tracks', 0),
            "description": getattr(playlist, 'description', '')
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/<playlist_id>/tracks', methods=['GET'])
def get_playlist_tracks(playlist_id):
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        playlist = session.playlist(playlist_id)
        tracks = playlist.tracks()
        
        result = []
        for t in tracks:
            image_url = None
            try:
                if t.album and getattr(t.album, 'cover', None):
                    image_url = t.album.image(dimensions=160)
            except Exception:
                pass
                
            result.append({
                "id": t.id,
                "name": t.name,
                "artists": [a.name for a in t.artists] if hasattr(t, 'artists') else ["Unknown Artist"],
                "album": t.album.name if t.album else "Unknown Album",
                "duration": getattr(t, 'duration', 0),
                "image": image_url
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/<playlist_id>/add', methods=['POST'])
def add_to_playlist(playlist_id):
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        data = request.json or {}
        track_id = data.get('track_id')
        track_ids = data.get('track_ids')
        
        if not track_ids and track_id:
            track_ids = [track_id]
            
        if not track_ids:
            return jsonify({"error": "No track IDs provided"}), 400
            
        playlist = session.playlist(playlist_id)
        playlist.add(track_ids)
        
        return jsonify({"success": True, "added": track_ids})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/<playlist_id>/remove/<int:index>', methods=['DELETE'])
def remove_from_playlist(playlist_id, index):
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        playlist = session.playlist(playlist_id)
        playlist.remove_by_index(index)
        
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/playlists/<playlist_id>/move', methods=['PUT'])
def move_playlist_track(playlist_id):
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        data = request.json or {}
        from_index = data.get('from_index')
        to_index = data.get('to_index')
        
        if from_index is None or to_index is None:
            return jsonify({"error": "Missing from_index or to_index"}), 400
            
        playlist = session.playlist(playlist_id)
        playlist.move_by_index(int(from_index), int(to_index))
        
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/search', methods=['GET'])
def search_tracks():
    try:
        if not session.check_login():
            return jsonify({"error": "Unauthenticated"}), 401
            
        query = request.args.get('q', '')
        if not query:
            return jsonify([])
            
        results = session.search(query, models=[tidalapi.Track], limit=15)
        
        tracks = []
        if hasattr(results, 'tracks'):
            tracks = results.tracks
        elif isinstance(results, dict) and 'tracks' in results:
            tracks = results['tracks']
            
        result = []
        for t in tracks:
            image_url = None
            try:
                if t.album and getattr(t.album, 'cover', None):
                    image_url = t.album.image(dimensions=160)
            except Exception:
                pass
                
            result.append({
                "id": t.id,
                "name": t.name,
                "artists": [a.name for a in t.artists] if hasattr(t, 'artists') else ["Unknown Artist"],
                "album": t.album.name if t.album else "Unknown Album",
                "duration": getattr(t, 'duration', 0),
                "image": image_url
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Listen on all interfaces so other devices on the local network can access the app
    app.run(host='0.0.0.0', port=5000, debug=True)
