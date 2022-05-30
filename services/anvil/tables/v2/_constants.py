import anvil.server

# USED as an argument to the "create_view" private method
READ = "r"
WRITE = "rw"
CASCADE = "rwc"
KNOWN_PERMS = (READ, WRITE, CASCADE)

NOT_FOUND = object()
CAP_KEY = "c"

SINGLE = "link_single"
MULTIPLE = "link_multiple"
DATETIME = "datetime"
MEDIA = "media"

SHARED_DATA_KEY = "anvil.tables"

SERVER_PREFIX = "anvil.private.tables.v2."


@anvil.server.portable_class("anvil.tables.v2.UNCACHED")
class _UncachedType(object):
    _instance = None

    def __new__(cls):
        self = cls._instance
        if self is None:
            cls._instance = self = object.__new__(cls)
        return self

    def __repr__(self):
        return "UNCACHED"

    @classmethod
    def __new_deserialized__(cls, data, info):
        return UNCACHED

    def __serialize__(self, info):
        return None


UNCACHED = _UncachedType()
