import sys as _sys

from anvil.server import portable_class as _portable

from ._schema import schema as _root_schema
from ._cls_overrides import _overrides, Base

_ModType = type(_sys)


def _cache(fn):
    cached = {}

    def wrapper(name, module, trace_type=None):
        args = (name, module, trace_type)
        seen = cached.get(args)
        if seen is not None:
            return seen
        rv = fn(name, module, trace_type)
        cached[args] = rv
        return rv

    return wrapper


@_cache
def _gen_cls(name, module, trace_type=None):
    try:
        cls = _overrides[module + "." + name]
        cls.__module__ = module
        cls.__name__ = name
    except KeyError:
        d = {"_name": name, "_module": module, "__module__": module}
        if trace_type:

            def __init__(self, d=None, **kws):
                Base.__init__(self, d, type=trace_type, **kws)

            d["__init__"] = __init__
        cls = type(name, (Base,), d)

    return _portable(cls)


class _LazyPlotlyMod(_ModType):
    __slots__ = "_schema_"

    def __init__(self, name, schema, package=True):
        _ModType.__init__(self, name, None)
        path = name.replace(".", "/")
        self.__file__ = path + "/__init__.py" if package else path + ".py"
        self._schema_ = schema
        self.__package__ = name  # might be overridden

    def __getattr__(self, attr):
        if attr == "__all__":

            def ignore(x):
                if x.startswith("_"):
                    return True
                defn = self._schema_.get(x)
                return defn is not None and defn["module"].endswith("_deprecations")

            self.__all__ = sorted(x for x in self.__dir__() if not ignore(x))
            return self.__all__

        cls_schema = self._schema_.get(attr)
        if cls_schema is not None:
            cls = _gen_cls(attr, **cls_schema)
            setattr(self, attr, cls)
            return cls

        raise AttributeError(attr)

    def __dir__(self):
        return sorted(set(_ModType.__dir__(self)) | set(self._schema_.keys()))


def _gen_mod(mod_name, schema, package):
    trace_types = {cls_name: {"module": mod_name, "trace_type": cls_name.lower()} for cls_name in schema.get("t", [])}
    mod_schema = {cls_name: {"module": mod_name} for cls_name in schema.get("a", [])}
    mod_schema.update(trace_types)

    mod = _LazyPlotlyMod(mod_name, mod_schema, package)
    _sys.modules[mod_name] = mod

    for leaf, s in schema.get("c", {}).items():
        package = not leaf.startswith("_")  # private modules are not packages (e.g graph_objs._bar)
        child = _gen_mod(mod_name + "." + leaf, s, package)
        if not package:
            child.__package__ = mod.__package__
            mod_schema.update(child._schema_)
        setattr(mod, leaf, child)

    return mod


graph_objs = _gen_mod("plotly.graph_objs", {"c": _root_schema}, True)

# do this after we've created graph_objs
from . import plotly, graph_objects
