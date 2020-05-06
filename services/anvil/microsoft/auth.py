import anvil.server

def login(*a, **k):
    raise Exception("anvil.microsoft.auth.login cannot be called from a server module")

def get_user_email():
    return anvil.server.call("anvil.private.microsoft.auth.get_user_email")

def get_user_id():
    return anvil.server.call("anvil.private.microsoft.auth.get_user_id")

def get_user_access_token():
    return anvil.server.call("anvil.private.microsoft.auth.get_user_access_token")

def get_user_refresh_token():
    return anvil.server.call("anvil.private.microsoft.auth.get_user_refresh_token")

def refresh_access_token(refresh_token):
    return anvil.server.call("anvil.private.microsoft.auth.refresh_access_token", refresh_token)
