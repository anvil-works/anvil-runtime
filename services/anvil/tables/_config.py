import anvil

_config = None


def get_client_config():
    global _config
    if _config is not None:
        return _config
    _config = anvil._get_service_client_config("/runtime/services/tables.yml") or {}
    return _config

def reset_config():
    global _config
    _config = None