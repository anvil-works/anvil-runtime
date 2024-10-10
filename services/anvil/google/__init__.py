
import anvil, anvil.server
from . import auth

_config = None

def get_config():
	global _config
	if _config is None:
		_config = anvil.server.call("anvil.private.google.get_config")
	return _config
