import anvil.server

#!defFunction(anvil.secrets,_,secret_name)!2: "Retrieve the named secret" ["get_secret"]
def get_secret(secret_name):
    return anvil.server.call("anvil.private.secrets.get_secret", secret_name)

#!defFunction(anvil.secrets,_,key_name,value)!2: "Encrypt a string with a cryptographic key derived from the named secret" ["encrypt_with_key"]
def encrypt_with_key(key_name, value):
    return anvil.server.call("anvil.private.secrets.encrypt_with_key", key_name, value)

#!defFunction(anvil.secrets,_,key_name,value)!2: "Decrypt a string with a cryptographic key derived from the named secret" ["decrypt_with_key"]
def decrypt_with_key(key_name, value):
    return anvil.server.call("anvil.private.secrets.decrypt_with_key", key_name, value)


#!defClass(anvil.secrets,SecretError)!:
class SecretError(anvil.server.AnvilWrappedError):
    pass

anvil.server._register_exception_type("anvil.secrets.SecretError", SecretError)
