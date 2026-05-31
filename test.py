import os
import sys
import subprocess

try:
    import venv
    with open("test_out.txt", "w") as f:
        f.write("venv is available\n")
except Exception as e:
    with open("test_out.txt", "w") as f:
        f.write(f"venv not available: {str(e)}\n")
