import anvil

_config = None

def get_config():
    global _config
    if _config is None:
        _config = anvil._get_service_client_config("/runtime/services/stripe.yml")
    return _config