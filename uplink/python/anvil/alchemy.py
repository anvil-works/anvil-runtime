import anvil.server
import json

from sqlalchemy import inspect
from sqlalchemy.orm.base import NO_VALUE

Base = None
_s = None


@anvil.server.live_object_backend
class DBObject(anvil.LiveObject):

    def __getitem__(self, name):

        if Base is None or _s is None:
            raise Exception("Cannot call __getitem__ before calling anvil.alchemy.initialise")

        id = json.loads(self._spec["id"])

        obj = _s.query(Base._decl_class_registry[id["__class__"]]).get(id["identity"])

        result = getattr(obj, name)

        if name in obj.__mapper__.relationships:
            return DBObject.wrap(result)
        else:
            return result

    def __setitem__(self, name, value):

        if Base is None or _s is None:
            raise Exception("Cannot call __setitem__ before calling anvil.alchemy.initialise")

        if self._spec["source"] == "client" and not "w" in self._spec["permissions"]:
            raise Exception("Cannot write this object from the client")

        id = json.loads(self._spec["id"])

        obj = _s.query(Base._decl_class_registry[id["__class__"]]).get(id["identity"])

        if isinstance(value, DBObject):
            val_id = json.loads(value._spec["id"])
            value = _s.query(eval(val_id["__class__"])).get(val_id["identity"])

        setattr(obj, name, value)

        _s.commit()

    @classmethod
    def wrap(cls, obj, writable=False):
        pk = inspect(obj).identity
        _class = obj.__class__

        id = json.dumps({
            "identity": pk,
            "__class__": _class.__name__
        })

        cache = {}
        attrs = inspect(obj).attrs
        for k in attrs.keys():
            v = attrs.get(k)

            if v.loaded_value != NO_VALUE and (isinstance(v.loaded_value, basestring) or
                                               isinstance(v.loaded_value, bool) or
                                               isinstance(v.loaded_value, int) or
                                               isinstance(v.loaded_value, float)):
                cache[k] = v.loaded_value

        if writable:
            permissions = ["w"]
        else:
            permissions = ["r"]

        return DBObject({
            "backend": "uplink.DBObject",
            "id": id,
            "permissions": permissions,
            "methods": ["__getitem__", "__setitem__"],
            "itemCache": cache
        })


def initialise(session_maker, base):
    global _s, Base
    _s = session_maker
    Base = base


@anvil.server.callable
def get_obj(cls, id):
    if Base is None or _s is None:
        raise Exception("Cannot call get_obj before calling anvil.alchemy.initialise")
    obj = _s.query(Base._decl_class_registry[cls]).get(id)
    return DBObject.wrap(obj)


# org = _s.query(Organisation).get(20)
# c = "parent_organisation_id"
#
# if c in org.__mapper__.relationships:
#     print "RELATIONSHIP"
# elif c in org.__mapper__.columns:
#     print "COLUMN"
# else:
#     print "UNKNOWN"
#
# print getattr(org, c)
