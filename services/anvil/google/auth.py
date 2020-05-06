import anvil.server

def get_user_email():
    return anvil.server.call("anvil.private.google.auth.get_user_email")

def login(additional_scopes=None):
	raise Exception("anvil.google.auth.login cannot be called from a server module - call it from your Form code instead")

def get_user_access_token():
	return anvil.server.call("anvil.private.google.auth.get_user_access_token")

def get_user_refresh_token():
	return anvil.server.call("anvil.private.google.auth.get_user_refresh_token")

def refresh_access_token(refresh_token):
	return anvil.server.call("anvil.private.google.auth.refresh_access_token", refresh_token)
