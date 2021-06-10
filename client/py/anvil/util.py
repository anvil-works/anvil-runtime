from anvil.server import serializable_type


def _wrap(value):
    if isinstance(value, (WrappedObject, WrappedList)):
        return value
    elif isinstance(value, dict):
        return WrappedObject(value)
    elif isinstance(value, list):
        wl = WrappedList()
        for i in value:
            wl.append(i)
        return wl
    else:
        return value


@serializable_type
class WrappedObject(dict):
    _name = None
    _module = None

    def __init__(self, d=None, **kwargs):

        if d and isinstance(d, dict):
            for k in d.keys():
                self.__setitem__(k, d[k])

        for k in kwargs.keys():
            self.__setitem__(k, kwargs[k])

    def __getattr__(self, key):
        return self.__getitem__(key)

    def __setattr__(self, key, value):
        self.__setitem__(key, value)

    def __setitem__(self, key, value):
        dict.__setitem__(self, key, _wrap(value))

    def __getitem__(self, key):
        _sentinel = WrappedObject()
        r = dict.get(self, key, _sentinel)

        if r is _sentinel:
            dict.__setitem__(self, key, _sentinel)

        return r

    def __repr__(self):
        n = self._name or "WrappedObject"
        m = self._module + "." if self._module else ""
        return "%s%s<%s>" % (
            m, n, ", ".join(["%s=%s" % (k, repr(self[k])) for k in self.keys()])
        )

    def __serialize__(self, global_data):
        return dict(self)

    def __deserialize__(self, data, global_data):
        self.__init__(data)

    def __copy__(self):
        return self.__class__(dict.copy(self))

    def __deepcopy__(self, memo):
        # lazy load this - its only need on the 
        # server and we don't want to load copy on the client
        from copy import deepcopy
        return self.__class__(deepcopy(dict(self)))


@serializable_type
class WrappedList(list):
    def __init__(self, lst=[]):
        for x in lst:
            self.append(x)

    def append(self, item):
        list.append(self, _wrap(item))

    def extend(self, items):
        for i in items:
            self.append(i)

    def insert(self, offset, item):
        list.insert(self, offset, _wrap(item))

    def __serialize__(self, global_data):
        return list(self)

    def __deserialize__(self, data, global_data):
        self.__init__(data)

    def __copy__(self):
        return self.__class__(list.copy(self))

    def __deepcopy__(self, memo):
        from copy import deepcopy
        return self.__class__(deepcopy(list(self)))