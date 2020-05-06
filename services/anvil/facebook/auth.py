import anvil.server

def get_user_email():
    return anvil.server.call("anvil.private.facebook.auth.get_user_email")

def get_user_id():
    return anvil.server.call("anvil.private.facebook.auth.get_user_id")

def get_user_access_token():
    return anvil.server.call("anvil.private.facebook.auth.get_user_access_token")

def login(*a, **k):
	raise Exception("facebook.auth.login cannot be called from a server module")
