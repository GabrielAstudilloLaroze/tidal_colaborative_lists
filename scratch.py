import tidalapi
print([method for method in dir(tidalapi.Session) if not method.startswith('_')])
