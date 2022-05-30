from anvil.server import portable_class

from ._row import Row

# Helpful classes for table methods that include Rows/SearchIterators
# But sending the Row across the wire is unnecessary
# We shouldn't be deserializing these objects but we include __deserialize__ for completeness


class _Ref(object):
    def __init__(self, cap):
        self.cap = cap

    def __hash__(self):
        return hash(self.cap)

    def __serialize__(self, info):
        return self.cap

    def __deserialize__(self, cap, info):
        self.cap = cap

    def __eq__(self, other):
        if type(self) is not type(other):
            return NotImplemented
        return self.cap == other.cap


@portable_class("anvil.tables.v2._RowRef")
class RowRef(_Ref):
    pass


@portable_class
class SearchIteratorRef(_Ref):
    pass


def to_ref(obj):
    ob_type = type(obj)
    if ob_type in (list, tuple):
        return tuple(to_ref(item) for item in obj)
    elif ob_type is Row:
        return RowRef(obj._cap)
    return obj


def make_refs(args_or_kws):
    if type(args_or_kws) is dict:
        return {key: to_ref(val) for key, val in args_or_kws.items()}
    else:
        return tuple(to_ref(val) for val in args_or_kws)
