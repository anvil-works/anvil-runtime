import anvil.server

from ._constants import SERVER_PREFIX

PREFIX = SERVER_PREFIX + "row."
_make_refs = None  # Circular import


class _Batcher:
    _name = ""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = object.__new__(cls)
        return cls._instance

    def __init__(self):
        self._active = False
        self._updates = ()
        self._func = PREFIX + self._name

    @property
    def active(self):
        return self._active

    def push(self, cap, update=False):
        self._updates += ((cap, update),)

    def reset(self):
        self._active = False
        self._updates = ()

    def __enter__(self):
        if self._active:
            raise RuntimeError("nested batching is not suppported")
        self._active = True

    def get_args(self, updates):
        raise NotImplementedError

    def __exit__(self, exc_type, exc_value, traceback):
        updates = self._updates
        self.reset()
        if exc_value is not None:
            return
        if not updates:
            return
        anvil.server.call(self._func, self.get_args(updates))
        for cap, update in updates:
            cap.send_update(update)


class BatchUpdate(_Batcher):
    _name = "batch_update"

    def get_args(self, updates):
        global _make_refs
        if _make_refs is None:
            from ._refs import make_refs  # circular import

            _make_refs = make_refs

        return [(cap, _make_refs(update)) for cap, update in updates]


class BatchDelete(_Batcher):
    _name = "batch_delete"

    def get_args(self, updates):
        return [cap for cap, _ in updates]


batch_update = BatchUpdate()
batch_delete = BatchDelete()
