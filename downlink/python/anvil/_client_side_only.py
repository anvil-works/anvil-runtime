class _ClientSideOnly(object):
    def __init__(self, name, msg=None, attr_msg=None, exc_type=Exception):
        self._name = name
        self._msg = msg or "You cannot use anvil.{name} in server modules"
        self._attr_msg = attr_msg or "anvil.{name} attributes are only available client-side"
        self._exc_type = exc_type

    def _raise(self):
        raise self._exc_type(self._msg.format(name=self._name))

    def __call__(self, *args, **kwargs):
        raise self._exc_type(self._msg.format(name=self._name))

    def __getattr__(self, attr):
        raise self._exc_type(self._attr_msg.format(name=self._name, attr=attr))
    
    def __enter__(self):
        raise self._exc_type(self._msg.format(name=self._name))
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        return False