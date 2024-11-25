import anvil
import anvil.server

from ._constants import SERVER_PREFIX, NOT_FOUND

PREFIX = SERVER_PREFIX + "row."
_make_refs = None  # Circular import

ThreadLocal = object

if anvil.is_server_side():
    try:
        from anvil._threaded_server import ThreadLocal
    except ImportError:
        pass


class _Batcher(ThreadLocal):
    _name = ""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = ThreadLocal.__new__(cls)
        return cls._instance

    def __init__(self):
        self._active = False
        self._updates = []
        self._buffer = {}
        self._func = PREFIX + self._name

    @property
    def active(self):
        return self._active

    def push(self, cap, update=False):
        self._updates.append((cap, update))

    def reset(self):
        self._active = False
        self._updates.clear()
        self._buffer.clear()

    def __enter__(self):
        if self._active:
            raise RuntimeError("nested batching is not suppported")
        self._active = True

    def get_args(self, updates):
        raise NotImplementedError

    def __exit__(self, exc_type, exc_value, traceback):
        updates = self._updates
        try:
            if exc_value is None and updates:
                anvil.server.call(self._func, self.get_args(updates))
                for cap, update in updates:
                    cap.send_update(update)
        finally:
            self.reset()


class BatchUpdate(_Batcher):
    _name = "batch_update"

    def push(self, cap, update):
        self._updates.append((cap, update))
        self._buffer.setdefault(cap, {}).update(update)

    def get_updates(self, cap):
        return self._buffer.get(cap, {})

    def read(self, cap, key):
        return self.get_updates(cap).get(key, NOT_FOUND)

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
