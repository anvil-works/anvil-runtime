import anvil

_config = None

def get_client_config():
    global _config
    if _config is None:
        _config = anvil._get_service_client_config("/runtime/services/anvil/users.yml")
    return _config
