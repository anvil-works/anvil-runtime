
import anvil, anvil.server

_config = None

def get_config():
	global _config
	if _config is None:
		_config = anvil.server.call("anvil.private.google.get_config")
		if _config is None:
			raise Exception("Google integration has not been configured. "\
					"See https://anvil.works/docs/integrations/google for more information")
	return _config
