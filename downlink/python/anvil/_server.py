# Helpers for implementing anvil.server.
# Used in uplink, downlink and pypy-sandbox.
import importlib

import anvil
import traceback
import numbers
import sys
import re
import json
import math
import anvil.tz
import functools

_do_call = None

string_type = str if sys.version_info >= (3,) else basestring
long_type = int if sys.version_info >= (3,) else long

POS_INFINITY = float("inf")
NEG_INFINITY = float("-inf")

_value_types = {}
_serialization_helpers = {} # {module_name: helper_fn}

class LiveObjectProxy(anvil.LiveObject):

    def __init__(self,spec,known_methods=None):
        for k in ["itemCache", "iterItems"]:
            if spec.get(k, {}) is None:
                del spec[k]

        if known_methods is not None:
            if spec.get("methods") is None:
                spec["methods"] = known_methods[spec["backend"]]
            else:
                known_methods[spec["backend"]] = spec["methods"]
        anvil.LiveObject.__init__(self, spec)

    def __getattr__(self, item):
        if item in self._spec["methods"]:
            def item_fn(*args, **kwargs):
                return _do_call(args, kwargs, fn_name=item, live_object=self)

            return item_fn
        else:
            raise AttributeError(item)

    def __getitem__(self, item):

        if "__anvil_iter_page__" in self._spec["methods"]:
            if isinstance(item, (int,long_type)):
                if item < 0:
                    raise IndexError("list index cannot be negative")

                iter = LiveObjectProxy.Iter(self, item)
                try:
                    return iter.next()
                except StopIteration:
                    raise IndexError("list index out of range")
            elif isinstance(item, slice):
                if (item.start and item.start < 0) or (item.stop and item.stop < 0) or (item.step and item.step < 0):
                    raise Exception("list slice indices and step cannot be negative")
                return LiveObjectProxy.Iter(self, item.start, item.stop, item.step)


        if item in self._spec.get("itemCache", {}):
            return self._spec["itemCache"][item]

        getitem = self.__getattr__("__getitem__")

        try:
            return getitem(item)
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)

    def __setitem__(self, key, value):
        if key in self._spec.get("itemCache", {}):
            del self._spec["itemCache"][key]

        setitem = self.__getattr__("__setitem__")
        try:
            r = setitem(key, value)
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)

        if "itemCache" in self._spec and (isinstance(value, string_type) or isinstance(value, numbers.Number) or isinstance(value, bool) or value is None):
            self._spec["itemCache"][key] = value

        return r

    class Iter:
        def __init__(self, live_object, start=None, stop=None, step=None):
            self._live_object = live_object

            i = live_object._spec.get("iterItems", {})
            self._idx = start if start is not None else 0
            self._items = i.get("items", None)
            self._next_page = i.get("nextPage", None)
            self._stop = stop
            self._step = step if step is not None else 1

        def _fetch_state(self):
            r = _do_call([self._next_page], {}, fn_name="__anvil_iter_page__", live_object=self._live_object)
            self._items = r["items"]
            self._next_page = r.get("nextPage", None)

        def __iter__(self):
            return self

        def next(self):
            if self._items is None:
                try:
                    self._fetch_state()
                except AnvilWrappedError as e:
                    raise _deserialise_exception(e.error_obj)

            if self._idx < len(self._items) and (self._stop is None or self._idx < self._stop):
                r = self._items[self._idx]
                self._idx += self._step
                return r

            if self._next_page is None or (self._stop is not None and self._idx >= self._stop):
                raise StopIteration

            self._idx -= len(self._items) if self._items is not None else self._idx
            if self._stop is not None:
                self._stop -= len(self._items) if self._items is not None else 0
            self._items = None
            return self.next()

        def __next__(self):
            return self.next()

    def __iter__(self):
        if "__anvil_iter_page__" in self._spec["methods"]:
            return LiveObjectProxy.Iter(self)
        else:
            raise Exception("Not iterable: <LiveObject: %s>" % self._spec.get("backend", "INVALID"))

    def __bool__(self):
        if "__nonzero__" in self._spec["methods"]:
            return self.__getattr__("__nonzero__")()
        else:
            return True

    __nonzero__ = __bool__

    def __len__(self):
        if "__len__" in self._spec["methods"]:
            return int(self.__getattr__("__len__")())
        else:
            l = 0
            for _ in self.__iter__():
                l += 1
            return l

_n_invalidations = 0
_invalidation_callbacks = []

def _on_invalidate_client_objects(f):
    _invalidation_callbacks.append(f)

def _run_invalidated_client_objects_callbacks():
    global _n_invalidations
    _n_invalidations += 1
    for f in _invalidation_callbacks:
        f()

def invalidate_client_objects():
    _do_call([], None, fn_name="anvil.private.invalidate_client_objects")
    _run_invalidated_client_objects_callbacks()


# Wildcard for unwrap_capability
class _CapAny(object):
    def __repr__(self):
        return "ANY"

def _check_valid_scope(scope, name="scope"):
    if type(scope) is not list:
            raise TypeError("The {} of a Capability must be a list".format(name))
    try:
        return json.loads(json.dumps(scope))
    except TypeError as e:
        raise TypeError("The {} provided is not valid JSON data. {}".format(name, e))


class Capability(object):
    def __init__(self, scope, mac=None, narrow=None):
        scope = _check_valid_scope(scope)
        self._scope = scope
        self._mac = mac
        if mac is not None:
            pass
        elif not len(scope):
            raise ValueError("Cannot construct a capability with an empty scope")
        elif scope[0] == "_":
            raise ValueError("To construct a Capability from scratch, its scope cannot start with ['_']")

        self._narrow = narrow or []
        self._do_apply_update = None
        self._do_get_update = None
        self._queued_update = {}
        self._hash = None
        self._n_invalidations = _n_invalidations

    @property
    def scope(self):
        return self._scope + self._narrow
    
    @property
    def is_valid(self):
        return self._n_invalidations == _n_invalidations

    def narrow(self, narrowing_suffix):
        narrowing_suffix = _check_valid_scope(narrowing_suffix, "narrow argument")
        return Capability(self._scope, self._mac, self._narrow + narrowing_suffix)

    def __repr__(self):
        return "<anvil.server.Capability:{}>".format(self.scope)

    def __eq__(self, other):
        if type(other) is not Capability:
            return NotImplemented
        return self.scope == other.scope

    def __hash__(self):
        if self._hash is None:
            self._hash = hash(json.dumps(self.scope))
        return self._hash

    def set_update_handler(self, apply_update, get_update=None):
        self._do_apply_update = apply_update
        self._do_get_update = get_update

    # RPC machinery:
    # An update has arrived from a server call. Default behaviour: Merge if it's a dict, overwrite if it isn't
    def _apply_update(self, update):
        if self._do_apply_update is not None:
            self._do_apply_update(update)

        if self._do_get_update is None:
            # Default update propagation rules
            if isinstance(update, dict):
                self._queued_update.update(**update)
            else:
                self._queued_update = update

    send_update = _apply_update

    # RPC machinery:
    # We're about to return from a server call which passed this capability in; do we have an update for them?
    # None -> nothing to send
    def _get_update(self):
        if self._do_get_update is not None:
            return self._do_get_update()
        else:
            return None if self._queued_update == {} else self._queued_update

    # Sentinel value for unwrap_capability
    ANY = _CapAny()

#!defFunction(anvil.server,list,capability,scope_pattern)!2: "Checks that its first argument is a valid Capability, and that its scope matches the supplied pattern.\n\nTo match, the scope must:\n - Be at least as broad as the pattern (ie the same length or shorter)\n- Contain the same values in the same position as the pattern - unless that position in the pattern is Capability.ANY, which matches any value\n\nReturns a list of matched scope elements, of the same length as the pattern. (If the scope was broader than required, missing elements are set to None.)" ["unwrap_capability"]
def unwrap_capability(cap, scope_pattern):
    if type(cap) is not Capability:
        raise TypeError("Not a valid Capability: found {}".format(type(cap).__name__))
    if type(scope_pattern) is not list:
        raise TypeError("scope_pattern should be a list, not {}".format(type(scope_pattern).__name__))

    scope = cap.scope
    ret = [None] * len(scope_pattern)

    if len(scope) > len(scope_pattern):
        raise ValueError("Capability is too narrow: required %s; got %s" % (scope_pattern, scope))

    for i in range(len(scope)):
        if scope_pattern[i] is Capability.ANY or scope[i] == scope_pattern[i] or type(scope_pattern[i]) is tuple and scope[i] == list(scope_pattern[i]):
            ret[i] = scope[i]
        else:
            raise ValueError("Incorrect Capability: required %s; got %s" % (scope_pattern, cap.scope))

    return ret

# DEPRECATED: replaced by unwrap_capability - included here for Backwards compatibility
Capability.require = staticmethod(unwrap_capability)


class SerializationInfo(object):
    def __init__(self, fromdata=None, remote_is_trusted=False):
        self._txdata = {}
        self._localdata = {}
        self._defaultkey = None
        self._trusted = remote_is_trusted
        self._enable_txdata = True
        if fromdata is None:
            pass
        elif type(fromdata) is dict:
            self._txdata[":GLOBAL"] = fromdata
        else:
            it = iter(fromdata)
            for k, v in zip(it, it):
                self._txdata[k] = v

    def __bool__(self):
        return bool(self._enable_txdata)

    __nonzero__ = __bool__

    def _to_json(self):
        if len(self._txdata) == 1 and ":GLOBAL" in self._txdata:
            return self._txdata[":GLOBAL"]
        else:
            r = []
            for k, v in self._txdata.items():
                r.append(k)
                r.append(v)
            return r

    def _resolve_key(self, key):
        if key is None:
            return self._defaultkey
        elif isinstance(key, type):
            try:
                return key.SERIALIZATION_INFO[0]
            except AttributeError:
                return key.__module__ + "." + key.__name__
        else:
            return ":" + str(key)

    def _set_default_key(self, key):
        self._defaultkey = key

    def _set_txdata_available(self, enable):
        self._enable_txdata = enable
    
    def _set_data_factory(self, _data, resolved_key, factory):
        data = _data.get(resolved_key)
        if data is None:
            data = _data[resolved_key] = factory()
        return data

    def shared_data(self, key=None, transmitted_data_factory=dict, local_data_factory=dict):
        key = self._resolve_key(key)
        localdata = self._set_data_factory(self._localdata, key, local_data_factory)
        if not self._enable_txdata:
            return None, localdata
        txdata = self._set_data_factory(self._txdata, key, transmitted_data_factory)
        return txdata, localdata

    @property
    def remote_is_trusted(self):
        return self._trusted

    @property
    def local_is_trusted(self):
        return anvil.is_server_side()

    def __repr__(self):
        # TODO adjust for public api
        return "SerializationInfo<" + repr(self._txdata) + ", " + repr(self._localdata) + ">"


# Backwards compatibility: If you use SerializationInfo like a dict, it man works like  if you use it like a dict
def _wrap_global_dict(attr_name):
    def f(self, *args, **kws):
        transmitted_data = self.shared_data("GLOBAL")[0]
        if transmitted_data is None:
            # using the old API so better to throw here
            raise RuntimeError("This object is part of shared_data; you cannot access shared_data from its __serialize__ method.")
        return getattr(transmitted_data, attr_name)(*args, **kws)
    return f


for method in ["__getitem__", "__setitem__", "__delitem__", "__iter__", "__len__", "__contains__", "keys", "items",
               "values", "get", "pop", "popitem", "clear", "update", "setdefault"]:
    setattr(SerializationInfo, method, _wrap_global_dict(method))


# DEPRECATED: there is no longer any reason to inherit from this
class Serializable(object):
    SERIALIZATION_INFO = None

    def __serialize__(self, info):
        return self.__dict__

    # You only need one of __deserialize__ (called instead of __init__)
    # or __new_deserialized__ (called instead of __new__+__init__).
    # (Of the two, you almost always want __deserialize__.)
    def __deserialize__(self, from_data, info):
        self.__dict__.update(from_data)

    @classmethod
    def __new_deserialized__(cls, from_data, info):
        obj = cls.__new__(cls)
        obj.__dict__.update(from_data)
        return obj


# Add-in for maintaining object identity across serialization
class SerializeWithIdentity(object):
    @classmethod
    def __new_deserialized__(cls, from_data, global_data):
        clsname, _ = cls.SERIALIZATION_INFO
        cache = global_data.get(clsname)
        if cache is None:
            cache = global_data[clsname] = {}
        my_id = from_data[0]
        # We use global_data to cache instances we're constructing
        # (non-JSONable keys certainly won't conflict with other global_data users)
        obj = cache.get(my_id)
        if obj is None:
            obj = cache[my_id] = cls.__new__(cls)

        if len(from_data) > 1:
            obj.__deserialize__(from_data[1], global_data)

        return obj

    def __serialize__(self, global_data):
        my_id, gd = self._serialization_key if hasattr(self, "_serialization_key") else (None, None)
        if gd is global_data:
            return [my_id]

        clsname, _ = self.SERIALIZATION_INFO
        my_id = global_data.get(clsname+"_max", 0)
        global_data[clsname+"_max"] = my_id + 1

        self._serialization_key = (my_id, global_data)

        data = self.__serialize_once__(global_data)
        if isinstance(data, dict):
            data = dict(data)
            data.pop("_serialization_key", None)

        return [my_id, data]


#!defFunction(anvil.server,%,[name])!2: {anvil$args: {name: "A unique name under which the class will be registered."}, $doc: "When applied to a class as a decorator, the class becomese available to be passed from server to client code."} ["portable_class"]
def portable_class(cls, name=None):
    def register(cls, name):
        if not hasattr(cls, "__new__"):
            raise TypeError("Portable classes must be new-style classes (inherit from object). %s is not a new-style class." % repr(cls))
        if name is None:
            name = cls.__module__ + "." + cls.__name__
        elif not isinstance(name, str):
            raise TypeError("The second argument to portable_class must be a str")
        _value_types[name] = cls
        cls.SERIALIZATION_INFO = (name, cls)
        return cls

    if name is None and isinstance(cls, str):
        name = cls
        return lambda cls: register(cls, name)
    else:
        return register(cls, name)


# Old name, for apps written before portable classes were released
serializable_type = portable_class


class LazyMedia(anvil.Media):
    def __init__(self, spec):
        if isinstance(spec, LazyMedia):
            spec = spec._spec
        self._spec = spec
        self._fetched = None

    def _fetch(self):
        if self._fetched is None:
            import anvil.server
            self._fetched = anvil.server.call("anvil.private.fetch_lazy_media", self._spec)
        return self._fetched

    def _get(self, key, attr=None):
        if attr is None:
            attr = key
        return self._spec[key] if key in self._spec else getattr(self._fetch(), attr)

    def get_name(self):
        try:
            return self._get("name")
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)

    def get_url(self, download=True):
        import anvil.server
        return anvil.server.call("anvil.private.get_lazy_media_url", self, download)

    def get_content_type(self):
        try:
            return self._get("mime-type", "content_type")
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)

    def get_length(self):
        try:
            rv = self._get("length")
            if rv is not None:
                return rv
            return self._fetch().get_length()
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)

    def get_bytes(self):
        try:
            return self._fetch().get_bytes()
        except AnvilWrappedError as e:
            raise _deserialise_exception(e.error_obj)


class AnvilWrappedError(Exception):
    registered_type_name = None

    def __init__(self, message=""):
        if isinstance(message, dict):
            self.manually_created = False
            self.error_obj = message
        else:
            self.manually_created = True
            self.error_obj = {"message": str(message), "trace": []}
            t = type(self).registered_type_name
            if t is not None:
                self.error_obj["type"] = t
        self.message = self.error_obj.get("message", "")
        Exception.__init__(self, self.message)

    def __repr__(self):
        r = Exception.__repr__(self)
        if type(self) is not AnvilWrappedError:
            return r
        eo_type = self.error_obj.get("type")
        if eo_type is None:
            return r

        return "AnvilWrappedError" + "(" + eo_type + r[len("AnvilWrappedError"):] + ")"


def augment_exception(exc_class):
    def f(error_obj):
        e = exc_class(error_obj['message'])
        e._anvil_error_obj = error_obj
        return e
    return f

_named_exceptions = {
    "KeyError": augment_exception(KeyError)
}


def _register_exception_type(name, cls):
    _named_exceptions[name] = cls
    cls.registered_type_name = name


def _deserialise_exception(error_obj):
    return _named_exceptions.get(error_obj.get("type"), AnvilWrappedError)(error_obj)


def get_liveobject_cache_filter_spec(input_data):
    """Returns a specification of a filter for LiveObject cache updates, which passes only LiveObjects present in input_data"""
    spec = {}

    def f(data):
        if isinstance(data, list):
            for i in data: f(i)
        elif isinstance(data, dict):
            for k,v in data.items(): f(v)
        elif isinstance(data, LiveObjectProxy):
            b = spec.get(data._spec["backend"])
            if b is None:
                b = spec[data._spec["backend"]] = set()
            b.add(data._spec["id"])

    f(input_data)
    return spec


def combine_cache_updates(updates, new_updates, filter_spec):
    if updates is None:
        updates = {}

    for k in new_updates:
        permitted_ids = filter_spec.get(k)
        if permitted_ids is None:
            continue
        caches = updates.get(k)
        if caches is None:
            caches = updates[k] = dict()
        for id in new_updates[k]:
            if id not in permitted_ids:
                continue
            caches[id] = new_updates[k][id]


def apply_cache_updates(cache_updates, objects_to_walk):
    """Recursively walk an object tree, applying cache updates wherever necessary"""

    def f(data):
        if isinstance(data, list):
            for i in data: f(i)
        elif isinstance(data, dict):
            for k,v in data.items(): f(v)
        elif isinstance(data, LiveObjectProxy):
            update = cache_updates.get(data._spec["backend"], {})
            if data._spec["id"] in update:
                data._spec["itemCache"] = update[data._spec["id"]]

    f(objects_to_walk)


class MaybeWrappedError(Exception):
    def __init__(self, message=""):
        if isinstance(message, dict):
            Exception.__init__(self, message["message"])
        else:
            Exception.__init__(self, message)


class SerializationError(MaybeWrappedError):
    pass


class InternalError(MaybeWrappedError):
    pass


class InvalidResponseError(MaybeWrappedError):
    pass


class RuntimeUnavailableError(MaybeWrappedError):
    pass


class UplinkDisconnectedError(MaybeWrappedError):
    pass


class ExecutionTerminatedError(MaybeWrappedError):
    pass


class TimeoutError(MaybeWrappedError):
    pass


class QuotaExceededError(MaybeWrappedError):
    pass


class NoServerFunctionError(AnvilWrappedError):
    pass


class CookieError(AnvilWrappedError):
    pass


class _FailError(MaybeWrappedError):
    pass


class BackgroundTaskError(MaybeWrappedError):
    pass


class BackgroundTaskNotFound(MaybeWrappedError):
    pass


class BackgroundTaskKilled(MaybeWrappedError):
    pass


class PermissionDenied(MaybeWrappedError):
    pass


class ServiceNotAdded(MaybeWrappedError):
    pass



_register_exception_type("anvil.server.SerializationError", SerializationError)
_register_exception_type("anvil.server.InternalError", InternalError)
_register_exception_type("anvil.server.InvalidResponseError", InvalidResponseError)
_register_exception_type("anvil.server.RuntimeUnavailableError", RuntimeUnavailableError)
_register_exception_type("anvil.server.UplinkDisconnectedError", UplinkDisconnectedError)
_register_exception_type("anvil.server.ExecutionTerminatedError", ExecutionTerminatedError)
_register_exception_type("anvil.server.TimeoutError", TimeoutError)
_register_exception_type("anvil.server.QuotaExceededError", QuotaExceededError)
_register_exception_type("anvil.server.NoServerFunctionError", NoServerFunctionError)
_register_exception_type("anvil.server.CookieError", CookieError)
_register_exception_type("anvil.server._FailError", _FailError)
_register_exception_type("anvil.server.BackgroundTaskError", BackgroundTaskError)
_register_exception_type("anvil.server.BackgroundTaskNotFound", BackgroundTaskNotFound)
_register_exception_type("anvil.server.PermissionDenied", PermissionDenied)
_register_exception_type("anvil.server.ServiceNotAdded", ServiceNotAdded)



def _report_exception(request_id=None):
    exc_type, exc_value, exc_traceback = sys.exc_info()
    tb = traceback.extract_tb(exc_traceback)

    trace = [(filename.replace("\\","/"), lineno) for (filename, lineno, _, _) in tb]
    trace.reverse()

    # Last element of trace is where we called into user code. Remove it.
    # TODO account for debugger here
    trace.pop()

    if isinstance(exc_value, AnvilWrappedError):
        if not exc_value.manually_created:
            # First element of trace is where we re-raised the exception. Remove it.
            trace = trace[1:]
        exc_value.error_obj["trace"] = exc_value.error_obj.get("trace", []) + trace
        r = {
            "error": exc_value.error_obj,
            "id": request_id
        }
        return r
    elif isinstance(exc_value, SyntaxError):
        # Remove whole internal trace and replace it with line where error occurred.
        trace=[(exc_value.filename, exc_value.lineno)]
        return {
            "error": {
                "type": "SyntaxError",
                "trace": trace,
                "message": str(exc_value)
            },
            "id": request_id
        }
    elif isinstance(exc_value, MaybeWrappedError):
        return {
            "error": {
                "type": "anvil.server.%s" % exc_type.__name__,
                "trace": trace,
                "message": str(exc_value),
            },
            "id": request_id
        }
    elif hasattr(exc_value, "_anvil_error_obj"):
        error_obj = dict(exc_value._anvil_error_obj)
        error_obj['trace'] = exc_value._anvil_error_obj.get("trace", []) + trace[1:]

        return {
            "error": error_obj,
            "id": request_id
        }
    else:
        return {
            "error": {
                "type": str(exc_type.__name__),
                "trace": trace,
                "message": str(exc_value),
            },
            "id": request_id
        }

def reconstruct_val(v, known_liveobject_methods, reconstruct_data_media=None):

    for t in v["type"]:
        if t == "DataMedia":
            if reconstruct_data_media is None:
                raise Exception("No data media deserialiser provided. Cannot reconstruct.")
            return reconstruct_data_media(v)
        elif t == "LazyMedia":
            return LazyMedia(v)
        elif t == "LiveObject":
            return reconstruct_live_object(v, known_liveobject_methods)
        elif t == "Capability":
            return Capability(v["scope"], v["mac"])
        elif t == "Date":
            return parsedate(v["value"]) if v["value"] else None
        elif t == "DateTime":
            return parsedatetime(v["value"]) if v["value"] else None
        elif t == "Long":
            return long_type(v["value"])
        elif t == "Float":
            return float(v["value"])
        elif t == "Primitive":
            return v["value"]
        elif t == "ValueType":
            return v["typeName"]
        elif t == "ClassType":
            return v["typeName"]

    raise Exception("Server module cannot accept an object of type '%s'" % v["type"][0])



def reconstruct_live_object(d, known_methods):

    # Need to fill out known_methods before we can reconstruct members:
    if d.get('methods') is not None:
        known_methods[d["backend"]] = d["methods"]

    reconstructed_item_cache = {}
    for k,v in d.get("itemCache", {}).items():
        reconstructed_item_cache[k] = reconstruct_val(v, known_methods)
    d["itemCache"] = reconstructed_item_cache

    if d.get("iterItems"):
        reconstructed_iteritems = []
        for i in d["iterItems"]["items"]:
            reconstructed_iteritems.append(reconstruct_val(i, known_methods))
        d["iterItems"]["items"] = reconstructed_iteritems

    return LiveObjectProxy(d, known_methods)


def serialise_val(v, known_liveobject_methods):
    import datetime
    if isinstance(v, long_type) and not isinstance(v, bool):
        return {
            "type": ["Long"],
            "value": str(v)
        }
    elif isinstance(v, float) and (v == POS_INFINITY or v == NEG_INFINITY or math.isnan(v)):
        return {
            "type": ["Float"],
            "value": "Infinity" if v == POS_INFINITY else \
                        "-Infinity" if v == NEG_INFINITY else \
                        "NaN"
        }
    elif isinstance(v, (numbers.Number, bool, string_type)) or v is None:
        return {
            "type": ["Primitive"],
            "value": v
        }
    elif isinstance(v, anvil.LiveObject):
        return serialise_live_object(v, known_liveobject_methods)
    elif isinstance(v, datetime.datetime):
        s = "%04d-%02d-%02d %02d:%02d:%02d.%06d" % (v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond)

        if v.tzinfo is not None:
            offset = v.tzinfo.utcoffset(v).total_seconds()
        else:
            offset = anvil.tz.tzlocal().utcoffset(v).total_seconds()

        sign = "+" if offset >= 0 else "-"
        z = "%s%02d%02d" % (sign, abs(int(offset/3600)), int((offset % 3600)/60))

        return {
            "type": ["DateTime"],
            "value": s + z
        }
    elif isinstance(v, datetime.date):
        s = "%04d-%02d-%02d" % (v.year, v.month, v.day)
        return {
            "type": ["Date"],
            "value": s
        }
    elif isinstance(v, LazyMedia):
        return dict(v._spec)
    else:
        for [n, cls] in _value_types.items():
            if isinstance(v, cls):
                type_name = n
                break
        else:
            raise Exception("Cannot serialise object of type %s" % type(v).__name__)

        return {
            "type": ["ValueType"],
            "typeName": type_name
        }


def serialise_live_object(obj, known_methods):
    obj = obj._spec.copy()
    obj["type"] = ["LiveObject"]

    km = known_methods.get(obj["backend"])
    if obj["methods"] == km:
        del obj["methods"]
    else:
        known_methods[obj["backend"]] = obj["methods"]

    serialised_item_cache = {}
    for k,v in sorted(obj.get("itemCache", {}).items(), key=lambda x: x[0]):
        # Dictionaries aren't ordered, so we can't allow this element
        # to write into known_methods. We give it a copy instead.
        serialised_item_cache[k] = serialise_val(v, known_methods.copy())
    obj["itemCache"] = serialised_item_cache

    if obj.get("iterItems"):
        serialised_iteritems = []
        for i in obj["iterItems"]["items"]:
            serialised_iteritems.append(serialise_val(i, known_methods))
        obj["iterItems"]["items"] = serialised_iteritems

    return obj


def _repr_path(p):
    return "".join(("[%s]" % repr(k) for k in p))

def _module_prefixes(module):
    module_parts = module.split(".")
    return [".".join(module_parts[:i]) for i in range(1, len(module_parts)+1)]

_called_serialization_helpers = set()

def _check_and_call_serialization_helper(cls_fullname):
    "checks if a class has a registered helper, calls the helper if it exists (once)"
    if cls_fullname in _called_serialization_helpers:
        return False

    for prefix in _module_prefixes(cls_fullname):
        if prefix in _serialization_helpers:
            _serialization_helpers[prefix](cls_fullname)
            _called_serialization_helpers.add(cls_fullname)
            return True

    return False


def fill_out_media(json, handle_media_fn, collect_capabilities=None, remote_is_trusted=False):
    obj_descr = []
    path = []
    known_liveobject_methods = {}
    serialization_info = SerializationInfo(remote_is_trusted=remote_is_trusted)
    import datetime

    def do_fom(_json):

        t_json = type(_json)

        if hasattr(_json, "SERIALIZATION_INFO"):
            type_name, tp = _json.SERIALIZATION_INFO
            valid_type_name = type_name in _value_types

            if valid_type_name and tp is _json:
                _json = None
                obj_descr.append({
                    "type": ["ClassType"],
                    "path": list(path),
                    "typeName": type_name
                })

            elif not valid_type_name or t_json is not tp:
                raise SerializationError("Cannot serialize %s (must be registered with @anvil.server.portable_class) at msg%s" % (t_json, _repr_path(path)))
            else:
                serialization_info._set_default_key(type_name)

                try:
                    serialize = _json.__serialize__
                except AttributeError:
                    def serialize(_):
                        return _json.__dict__

                content = serialize(serialization_info)

                _json = do_fom(content)

                # Append this afterwards, so we deserialise our content first
                obj_descr.append({
                    "type": ["ValueType"],
                    "path": list(path),
                    "typeName": type_name
                })

        elif isinstance(_json, dict):
            _json = dict(_json)
            for k,v in sorted(_json.items(),key=lambda x: x[0]):
                if not isinstance(k, string_type):
                    raise SerializationError("Cannot serialize dictionaries with keys that aren't strings at msg%s" % _repr_path(path + [k]))
                path.append(k)
                _json[k] = do_fom(v)
                path.pop()
        elif isinstance(_json, list) or isinstance(_json, tuple):
            _json = list(_json)
            for i in range(len(_json)):
                path.append(i)
                _json[i] = do_fom(_json[i])
                path.pop()
        elif isinstance(_json, LazyMedia):
            d = dict(_json._spec)
            d["path"] = list(path)
            obj_descr.append(d)
            _json = None
        elif isinstance(_json, anvil.Media):
            extra = handle_media_fn(_json)
            d = {"type": ["DataMedia"], "path": list(path), "mime-type": _json.content_type, "name": _json.name}
            if extra is not None:
                d.update(extra)
            obj_descr.append(d)
            _json = None
        elif isinstance(_json, Capability):
            if collect_capabilities is not None:
                collect_capabilities.append(_json)
            d = {
                "type": ["Capability"],
                "path": list(path),
                "scope": _json._scope,
                "mac": _json._mac
            }
            if _json._narrow:
                d["narrow"] = _json._narrow
            obj_descr.append(d)
            _json = None
        elif isinstance(_json, anvil.LiveObject):
            #print "Serialising LiveObject: " + repr(_json._spec) + " at " + repr(path)
            serialised_liveobject = serialise_live_object(_json, known_liveobject_methods)
            serialised_liveobject["path"] = list(path)
            obj_descr.append(serialised_liveobject)
            _json = None
        elif isinstance(_json, (datetime.date, datetime.datetime)) or \
                (isinstance(_json, long_type) and (_json > 2147483647 or _json < -2147483647)) or \
                (isinstance(_json, float) and (_json == POS_INFINITY or _json == NEG_INFINITY or math.isnan(_json))):
            serialised_val = serialise_val(_json, known_liveobject_methods)
            serialised_val["path"] = list(path)
            obj_descr.append(serialised_val)
            _json = None
        elif _check_and_call_serialization_helper(t_json.__module__ + "." + t_json.__name__):
            _json = do_fom(_json)
        elif 'numpy' in sys.modules and hasattr(sys.modules['numpy'], 'generic') and isinstance(_json, sys.modules['numpy'].generic):

            _json = _json.item() # convert

        elif not (isinstance(_json, string_type) or _json is None or _json is True or _json is False or isinstance(_json, (int, long_type)) or isinstance(_json, float)):

            # Rescue: Convert numpy types to nearest equivalent
            if 'numpy' in sys.modules:
                import numpy
                if isinstance(_json, numpy.ndarray):
                    _json = do_fom(_json.tolist())
                else:
                    raise SerializationError("Cannot serialize %s object at msg%s" % (t_json, _repr_path(path)))
            else:
                raise SerializationError("Cannot serialize %s object at msg%s" % (t_json, _repr_path(path)))

        return _json

    json = do_fom(json)

    vt_global = serialization_info._to_json()
    if len(vt_global) != 0:
        path.append("vt_global")
        serialization_info._set_txdata_available(False)
        od = obj_descr
        obj_descr = []
        json["vt_global"] = do_fom(vt_global)
        obj_descr += od
        path.pop()

    json["objects"] = obj_descr

    return json


def fill_out_cap_updates(resp, caps_passed_in):
    """We're about to return from a call; ask all the capabilities that got passed in whether they want to send
       any updates to our caller."""

    for cap in caps_passed_in:
        update = cap._get_update()
        if update is not None:
            cu = resp.get('capUpdates')
            if cu is None:
                cu = resp['capUpdates'] = {}
            cu[json.dumps(cap.scope)] = update


def apply_cap_updates(resp, caps_passed_out):
    """We have just made a server call that has returned. Apply any necessary updates to the capabilities we
       passed into this call"""

    updates = resp.get('capUpdates', {})

    # Normalise updates to how _this_ `json` impl does things (ugh)
    updates = {json.dumps(json.loads(k)): v for k,v in updates.items()}

    for cap in caps_passed_out:
        scope_json = json.dumps(cap.scope)
        update = updates.get(scope_json)
        if update is not None:
            cap._apply_update(update)


def simple_strpdate(s):
    import datetime
    return datetime.date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def simple_strpdatetime(s):
    import datetime
    return datetime.datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19]), int(s[20:26])) # datetime.datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f")

def parsedate(s):
    return simple_strpdate(s)


def parsedatetime(s):

    has_tz = len(s) > 5 and \
             (s[-5] == "-" or s[-5] == "+") and \
             48 <= ord(s[-4]) <= 57 and \
             48 <= ord(s[-3]) <= 57 and \
             48 <= ord(s[-2]) <= 57 and \
             48 <= ord(s[-1]) <= 57

    if not has_tz:
        # Parse a naive datetime
        return simple_strpdatetime(s)

    # Timezone present. First parse without it
    d = simple_strpdatetime(s[:-5])

    # Now construct a tzoffset
    hours = int(s[-5:-2])
    minutes = int(s[-5] + s[-2:])
    total_minutes = hours*60+minutes

    return d.replace(tzinfo=anvil.tz.tzoffset(minutes=total_minutes))

def _retrieve_portable_class(type_name, d):
    value_type = _value_types.get(type_name)
    if value_type is not None:
        return value_type
    # Try importing the relevant module
    i = type_name.rfind('.')
    if i != -1:
        # TODO do we filter what we can specify as import? I don't *think* this is dangerous...
        if not _check_and_call_serialization_helper(type_name):
            module_name = type_name[:i]
            importlib.import_module(module_name)
        value_type = _value_types.get(type_name)

    if value_type is None:
        raise SerializationError("No such serializable type: %s at msg%s" % (type_name, _repr_path(d["path"])))

    return value_type


def _reconstruct_objects(json, reconstruct_data_media, hold_back_value_types=False, collect_capabilities=None, remote_is_trusted=False):
    known_liveobject_methods = {}
    serialization_info = SerializationInfo(json.get("vt_global"), remote_is_trusted=remote_is_trusted) if not hold_back_value_types else None

    if "objects" in json:
        held_back_objects = []
        for d in json["objects"]:
            if hold_back_value_types and ("ValueType" in d["type"] or "ClassType" in d["type"]):
                held_back_objects.append(d)
                continue

            reconstructed = reconstruct_val(d, known_liveobject_methods, reconstruct_data_media)
            if collect_capabilities is not None and type(reconstructed) is Capability:
                collect_capabilities.append(reconstructed)

            obj = json
            last_obj = None
            key = None
            for k in d["path"]:
                last_obj = obj
                key = k
                obj = obj[k]

            if last_obj is not None:

                if "ValueType" in d["type"]:
                    # Hack: The "reconstructed value" here is actually just the type name
                    type_name = reconstructed
                    value_type = _retrieve_portable_class(type_name, d)
                    try:
                        reconstruct = value_type.__new_deserialized__
                    except AttributeError:
                        def reconstruct(data, info):
                            obj = value_type.__new__(value_type)
                            try:
                                deserialize = obj.__deserialize__
                            except AttributeError:
                                def deserialize(data, info):
                                    obj.__dict__.update(data)
                            deserialize(data, info)
                            return obj

                    serialization_info._set_txdata_available(d["path"][0] != 'vt_global')
                    serialization_info._set_default_key(type_name)
                    last_obj[key] = reconstruct(last_obj[key], serialization_info)
                elif "ClassType" in d["type"]:
                    last_obj[key] = _retrieve_portable_class(reconstructed, d)
                else:
                    last_obj[key] = reconstructed

        if hold_back_value_types:
            json["objects"] = held_back_objects
        else:
            del json["objects"]

    return json

on_register = None # optional
registrations = {}

registrations = {}

_registration_warning = "Warning: a callable with the name {!r} has already been registered (previously by {!r} now by {!r})."
_warnings = []

def _add_to_register(name, fn, ignore_warnings=False):
    if not ignore_warnings and name in registrations and name not in _warnings:
        prev = registrations[name]
        print(_registration_warning.format(name, "%s.%s" % (prev.__module__, prev.__name__), "%s.%s" % (fn.__module__, fn.__name__)))
        _warnings.append(name)
    registrations[name] = fn


class HttpRequest(object):

    def __init__(self):
        self._prevent_access = True

    def __getattribute__(self, name):
        if object.__getattribute__(self, "_prevent_access"):
            raise Exception("anvil.server.request is only available in http_endpoint calls.")

        return object.__getattribute__(self, name)

    @property
    def body_json(self):
        if hasattr(self, "_body_json"):
            return self._body_json
        elif self.body is not None and self.headers.get("content-type", "").split(";")[0] == "application/json":
            self._body_json = json.loads(self.body.get_bytes())
        else:
            self._body_json = None
        return self._body_json




api_request = HttpRequest()

def _lower_str(s):
    if not isinstance(s, str):
        return s
    return s.lower()

class HttpHeaders(object):

    def __init__(self, headers=None):
        headers = headers or {}
        assert isinstance(headers, dict), "headers should be a dict"
        headers = {_lower_str(h): v for (h, v) in headers.items()}
        self._headers = list(headers.items())

    def __setitem__(self, name, val):
        name = _lower_str(name)
        self._headers = [(h,v) for (h,v) in self._headers if h != name]

        self.add(name, val)

    def __delitem__(self, name):
        name = _lower_str(name)
        self._headers = [(h,v) for (h,v) in self._headers if h != name]

    def add(self, name, val):
        self._headers.append((name, val))

    def clear(self):
        self._headers = []

    def copy(self):
        new_self = HttpHeaders()
        new_self._headers = self._headers.copy()
        return new_self

    def __repr__(self):
        return "HttpHeaders(" + repr(self._headers) + ")"


class HttpResponse(object):
    def __init__(self, status=200, body="", headers=None):
        self.status = status
        self.body = body
        self.headers = headers

    @property
    def headers(self):
        return self._headers

    @headers.setter
    def headers(self, value):
        if value is None or isinstance(value, dict):
            self._headers = HttpHeaders(value)
        elif isinstance(value, HttpHeaders):
            self._headers = value.copy()
        else:
            raise TypeError("headers should be set to a dictionary")


def _ensure_only_kws(class_name, args, kwargs, expected_kwargs):
    if args:
        raise TypeError("{}() takes keyword arguments only".format(class_name))
    for key in kwargs:
        if key not in expected_kwargs:
            raise TypeError("{}() got an unexpected keyword argument '{}'".format(class_name, key))

# Private API
@portable_class("anvil.server._LoadAppResponse")
class _LoadAppResponse(object):
    def __init__(self, **kws):
        self.__dict__.update(kws)


#!defFunction(anvil.server,%,[form],*args,**kws)!2:
# {
#   $doc: "Open the specified form as a new page from a route.\n\n'form' is a string, and when received by the client the new form will be created (extra arguments will be passed to its constructor).",
#   anvil$helpLink: "/docs/"
# } ["FormResponse"]
def FormResponse(form_name, *args, **kwargs):
    return _LoadAppResponse(form=form_name, args=args, kwargs=kwargs)


class AppResponder(object):
    #!defMethod(_, data=None, meta=None)!2: ("Create an AppResponder object") ["__init__"];
    def __init__(self, *args, **kws):
        # because keyword only syntax is not supported in python2
        _ensure_only_kws("AppResponder", args, kws, ["data", "meta"])
        self.data = kws.get("data")
        self.meta = kws.get("meta")

    #!defMethod(_, [form], *args, **kwargs)!2: ("Open the specified form as a new page from a route") ["load_form"];
    def load_form(self, form_name, *args, **kwargs):
        return _LoadAppResponse(
            data=self.data, meta=self.meta, form=form_name, args=args, kwargs=kwargs
        )

    #!defMethod(_, module_name)!2: ("Opens the specified module as a new page from a route") ["load_module"];
    def load_module(self, module_name):
        return _LoadAppResponse(data=self.data, meta=self.meta, module=module_name)

    #!defMethod(_)!2: ("Loads an app at it's startup form/module") ["load_app"]; 
    def load_app(self):
        return _LoadAppResponse(data=self.data, meta=self.meta)

#!defClass(anvil.server,%AppResponder)!0:

class CallContext(object):
    class ClientInfo(object):
        def __repr__(self):
            return "<ClientInfo:%s>" % repr(self.__dict__)

    class Location(object):
        def __init__(self, location):
            self.city = location.get('city')

            self.subdivision = location.get('subdivision', {}).get('name')

            l = location.get('location', {})
            self.latitude = l.get('lat')
            self.longitude = l.get('lng')

            c = location.get('country', {})
            self.country_code = c.get('code')
            self.country = c.get('name')

        def __repr__(self):
            return "<Location:%s>" % repr(self.__dict__)

    class StackFrame(object):
        def __init__(self, sf):
            self.type = sf.get("type")
            self.is_trusted = self.type in {'server_module', 'uplink', 'background_task'}

        def __repr__(self):
            return "<StackFrame:%s>" % repr(self.__dict__)

    _DEFAULT_TYPE = "server_module"

    def _setup(self, client, call_stack):
        self.type = CallContext._DEFAULT_TYPE
        if client is not None:
            self.client = CallContext.ClientInfo()
            self.client.type = client.get('type')
            self.client.ip = client.get('ip')
            self.background_task_id = client.get('background-task-id')
            l = client.get('location')
            self.client.location = CallContext.Location(l) if l else None
            self.remote_caller = CallContext.StackFrame(call_stack[0] if call_stack else client)
        else:
            self.client = None
            self.remote_caller = None
            self.background_task_id = None

    __init__ = _setup

    def __repr__(self):
        return "<CallContext:%s>" % repr(self.__dict__)


# can be used as a decorator too
# N.B. There is a full implementation of the 'require=' kwarg here, but we've chosen not to expose it yet. If we expose it, will need to pass through from callable, like require_user.
def register(fn, name=None, name_prefix=None, require_user=None):
    require=None

    if isinstance(fn, string_type):
        # Someone's using the old syntax. Our bad.
        (fn, name) = (name, fn)

    if name is None:
        name = fn.__name__

    original_name = name
    if name_prefix is not None:
        name = "%s:%s" % (name_prefix, name)

    # 'require_user' is either True (check that user is logged in), False (equivalent to None), or 
    # a function that takes the currently logged in user and returns whether to let them in.

    if require_user == True:
        def simple_require_user():
            import anvil.users
            if anvil.users.get_user() is None:
                raise anvil.users.AuthenticationFailed("You must be logged in to call this server function")
            return True
        require = simple_require_user
    elif require_user == False:
        require = None
    elif require_user is not None:
        # Must be a function.
        def complex_require_user():
            import anvil.users
            user = anvil.users.get_user()
            if user is None:
                raise anvil.users.AuthenticationFailed("You must be logged in to call server function '%s'" % original_name)
            elif not require_user(user):
                raise PermissionDenied("You do not have permission to call server function '%s'" % original_name)
            else:
                return True
        require = complex_require_user

    # 'require' is an optional function that returns something truthy if the user should be let in. Otherwise, it can raise 
    # an Exception (which will be passed on) or return something falsey (in which case a PermissionDenied exception will be raised.)

    if require is not None:
        def require_wrap(f):
            @functools.wraps(f)
            def with_req(*args, **kwargs):
                if require():
                    return f(*args, **kwargs)
                else:
                    raise PermissionDenied("You do not have permission to call server function '%s'" % original_name)
            return with_req
    else:
        def require_wrap(f):
            return fn

    _add_to_register(name, require_wrap(fn))

    if on_register is not None:
        on_register(name, False)

    def reregister(new_f):
        _add_to_register(name, require_wrap(new_f), ignore_warnings=True)
        new_f._anvil_reregister = reregister

    fn._anvil_reregister = reregister

    return fn

#!defFunction(anvil.server,%,[fn_or_name], [require_user])!2: {anvil$args: {fn_or_name: "The name by which you want to call your function from the client.", require_user: "Allows you to verify whether a user is logged in. Can be a boolean or a function."}, anvil$helpLink: "/docs/server#calling-server-functions-from-client-code", $doc: "When applied to a function as a decorator, the function becomes available from the client side."} ["callable"]
def callable(fn_or_name=None, require_user=None):
    if fn_or_name is None or isinstance(fn_or_name, string_type):
        return lambda f: register(f, fn_or_name, require_user=require_user)
    else:
        return register(fn_or_name)

#!defFunction(anvil.server,%,[fn_or_name])!2: {anvil$args: {fn_or_name: "The name by which you want to call your function."}, anvil$helpLink: "/docs/background-tasks", $doc: "When applied to a function as a decorator, the function becomes available to run in the background."} ["background_task"]
def background_task(fn_or_name=None):
    if fn_or_name is None or isinstance(fn_or_name, string_type):
        return lambda f: register(f, fn_or_name, name_prefix="task")
    else:
        return register(fn_or_name, name_prefix="task")


# A parameterised decorator
def callable_as(name):
    print("@callable_as is deprecated. Please use @callable directly.")
    return lambda f: register(f, name)



def http_endpoint(path, require_credentials=False, authenticate_users=False, authenticate_user=False,
                  methods=["GET","POST"], enable_cors=False, cross_site_session=False, _task_prefix="http"):
    def decorator(fn):
        path_parts = []
        def register_path_part(s):
            path_parts.append(s.group(1))
            return "([^/]*)"

        path_regex = re.sub(":([^/]*)", register_path_part, path)

        @functools.wraps(fn)
        def wrapped_fn(method, path, query_params, form_params, origin, headers, remote_address, body, username, password, same_app_alternate_origin=None, **more_kwargs):

            api_request._prevent_access = False

            if cross_site_session:
                import anvil.server
                anvil.server._switch_session()

            api_request.user = None
            if authenticate_users or authenticate_user:
                import anvil.users
                try:
                    api_request.user = anvil.users.get_user() or \
                                        anvil.users.login_with_email(username, password)
                except Exception as e:
                    return {"status": 401,
                            "body": "Unauthorized",
                            "headers": {"WWW-Authenticate": "Basic realm=\"Anvil App API\""}}
            elif require_credentials:
                if username is None or password is None:
                    return {"status": 401,
                            "body": "Unauthorized",
                            "headers": {"WWW-Authenticate": "Basic realm=\"Anvil App API\""}}

            def add_cross_origin_to_header_dict(d):
                if enable_cors:
                    d["Access-Control-Allow-Origin"] = enable_cors if isinstance(enable_cors, str) else "*"
                elif same_app_alternate_origin:
                    d["Access-Control-Allow-Origin"] = same_app_alternate_origin
                if enable_cors or same_app_alternate_origin and \
                        "access-control-allow-headers" not in [h.lower() for h in d.keys()]:
                    allow_headers = ["content-type"]
                    for k in headers.keys():
                        if k.lower() == "access-control-request-headers":
                            hs = [h.strip().lower() for h in headers[k].split(",")]
                            allow_headers += [h for h in hs if h not in allow_headers]

                    d["Access-Control-Allow-Headers"] = ", ".join(allow_headers)

                return d

            if method not in methods:
                if method == "OPTIONS" and (enable_cors or same_app_alternate_origin):
                    return {"status": 200,
                            "body": "",
                            "headers": add_cross_origin_to_header_dict({})}
                else:
                    return {"status": 405,
                            "body": "Method not supported",
                            "headers": {"Allow": ", ".join(methods)}}

            api_request.path = path
            api_request.method = method
            api_request.query_params = query_params
            api_request.form_params = form_params
            api_request.origin = origin
            api_request.headers = headers
            api_request.remote_address = remote_address
            api_request.body = body
            api_request.username = username
            api_request.password = password


            # Path takes precedence over query params. Query params take precedence over form params.
            kwargs = dict(form_params)
            kwargs.update(query_params)
            match = re.match(path_regex, path)
            for i,m in enumerate(match.groups()):
                kwargs[path_parts[i]] = m

            response = fn(**kwargs)

            api_request._prevent_access = True

            if isinstance(response, HttpResponse):
                return {"status":  response.status,
                        "body":    response.body,
                        "headers": add_cross_origin_to_header_dict(response.headers)._headers}
            else:
                return {"status":  200,
                        "body":    response,
                        "headers": add_cross_origin_to_header_dict({})}

        register(wrapped_fn, path_regex, _task_prefix)

        return fn
    return decorator


wellknown_endpoint = functools.partial(http_endpoint, _task_prefix="http-wellknown")

route = functools.partial(http_endpoint, _task_prefix="route")


class AnvilCookie(object):

    def __init__(self, type):
        self._type = type

    def __getitem__(self, name):
        return _do_call([self._type, name], None, fn_name="anvil.private.get_cookie")

    def __setitem__(self, name, value):
        kw = {}
        kw[name] = value
        self.set(30, **kw)

    def __delitem__(self, name):
        _do_call([self._type, name], None, fn_name="anvil.private.del_cookie")

    def get(self, key, default=None):
        try:
            return _do_call([self._type, key], None, fn_name="anvil.private.get_cookie")
        except KeyError:
            return default

    def set(self, timeout_days=30, **values):
        _do_call([self._type, timeout_days], values, fn_name="anvil.private.set_cookie")

    def clear(self):
        _do_call([self._type], None, fn_name="anvil.private.clear_cookie")


class CookieContainer(object):

    def __init__(self):
        self.local = AnvilCookie("local")
        self.shared = AnvilCookie("shared")


cookies = CookieContainer()


class NotABackgroundTaskState(object):
    def __setitem__(self, key, value):
        raise Exception("Cannot access anvil.server.task_state outside a background task")

    def __getitem__(self, item):
        raise Exception("Cannot access anvil.server.task_state outside a background task")


# Raise event on all sessions in the current environment, on a specific session, on multiple sessions, or on a named channel
def raise_event(name, payload=None, session_id=None, session_ids=None, channel=None):
    anvil.server.call("anvil.private.raise_event", name, payload, session_id=session_id, session_ids=session_ids, channel=channel)


# List all sessions in the current environment, or only those where the specified user is logged in.
def list_client_sessions(user=None):
    return anvil.server.call("anvil.private.list_sessions", user=user)


# Get the value of anvil.server.session for a particular session in the current environment
def get_client_session(session_id):
    return anvil.server.call("anvil.private.get_session_data", session_id)


# Get the ID of the current session
#!defFunction(anvil.server,%)!2: "Returns the current session's ID." ["get_session_id"]
def get_session_id():
    return anvil.server.call("anvil.private.get_session_id")


# Subscribe this session to receive events from the named channel
def subscribe(channel):
    return anvil.server.call("anvil.private.subscribe", channel)


# Unsubscribe this session from receiving events from the named channel
def unsubscribe(channel):
    return anvil.server.call("anvil.private.unsubscribe", channel)


def get_subscriptions():
    return anvil.server.call("anvil.private.get_subscriptions")


def plotly_serialization_helper(class_fullname):
    name_parts = class_fullname.split(".")
    module_name = ".".join(name_parts[:-1])
    class_name = name_parts[-1]

    module = importlib.import_module(module_name)
    cls = getattr(module, class_name)

    if not hasattr(cls, '__serialize__'):
        # print(f"Registering {cls}")
        def serialize(self, global_data):
            # print("Serialising %s on downlink" % type(self))
            return self.to_plotly_json()

        @staticmethod
        def new_deserialized(data, global_data):
            # print("Deserialising %s on downlink" % cls)
            return cls(data)

        cls.__serialize__ = serialize
        cls.__new_deserialized__ = new_deserialized
        portable_class(cls, class_fullname)


_serialization_helpers["plotly.graph_objs"] = plotly_serialization_helper


class server_side_method:
    """Decorator to wrap functions that should be executed on the server-side only"""
    def __init__(self, func):
        if func is not None and not hasattr(func, "__get__"):
            raise TypeError("@server_side must be called with a function")
        self._func = func

    def __set_name__(self, owner, name):
        import anvil.server, functools
        cname = "anvil.server_side/" + owner.__module__ + "." + owner.__name__ + "." + name
        func = self._func

        @anvil.server.callable(cname)
        @functools.wraps(self._func)
        def server_func(*args, **kwargs):
            if not args or not isinstance(args[0], owner):
                raise TypeError("'self' argument to method must be " + owner)
            return func(*args, **kwargs)

    def __get__(self, instance, owner):
        return self._func.__get__(instance, owner)
