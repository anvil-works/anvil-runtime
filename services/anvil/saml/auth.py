import anvil.server

def login(*a, **k):
    raise Exception("anvil.saml.auth.login cannot be called from a server module")

def get_user_email():
    return anvil.server.call("anvil.private.saml.auth.get_user_email")

def get_user_attributes():
    return anvil.server.call("anvil.private.saml.auth.get_user_attributes")
