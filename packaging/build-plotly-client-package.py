#!python

### RUNTIME/PACKAGING

import plotly
import os
import inspect
from pprint import pprint

os.chdir(os.path.dirname(os.path.realpath(__file__)))

OUT_DIR="../../runtime/py/plotly"
os.chdir(OUT_DIR)
try:
    os.rmdir("graph_objs")
except:
    pass


## First generate all plotly objects that have the to_plotly_json method.


pkgs = {}

def all_subclasses(cls):
    return set(cls.__subclasses__()).union(
        [s for c in cls.__subclasses__() for s in all_subclasses(c)])

all_plotly_types = all_subclasses(plotly.basedatatypes.BasePlotlyType).union([plotly.graph_objs._figure.Figure])
all_trace_types = all_subclasses(plotly.basedatatypes.BaseTraceType)

for c in all_plotly_types:
    pkg_path = c.__module__[7:].replace(".","/")

    if not pkg_path.startswith("graph_objs"):
        continue

    if pkg_path not in pkgs:
        pkgs[pkg_path] = []

    pkgs[pkg_path].append(c)


for p,cs in pkgs.items():
    os.makedirs(p, exist_ok=True)
    with open(f"{p}/__init__.py", "w") as init:
        init.write("""
from anvil.util import WrappedObject, WrappedList
from anvil.server import portable_class

""")

## TODO: "type" key on traces
        for c in sorted(cs, key=lambda x: x.__name__):
            init.write(f"""
@portable_class
class {c.__name__}(WrappedObject):
    _name = "{c.__name__}"
    _module = "{c.__module__}"
""")
            if c in all_trace_types:
                init.write(f"""
    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='{c.__name__.lower()}', **kwargs)
""")



## Now deal with _deprecations module (and importing it from graph_objs)

import plotly.graph_objs._deprecations as dep_module

deprecated_classes = [class_obj for class_name, class_obj in inspect.getmembers(dep_module, inspect.isclass)]

with open(f"graph_objs/_deprecations.py", "w") as _deps:
    _deps.write("""
from anvil.util import WrappedObject
from anvil.server import portable_class

""")

    for c in deprecated_classes:
        _deps.write(f"""
@portable_class
class {c.__name__}(WrappedObject):
    _name = "{c.__name__}"
    _module = "{c.__module__}"
""")

with open(f"graph_objs/__init__.py", "a") as init:
    init.write("\n\n")
    for c in sorted(deprecated_classes, key=lambda x: x.__name__):
        init.write(f"from ._deprecations import {c.__name__}\n")

## Now make sure that everything imports everything else, and specifies __all__

#pprint([x for x in pkgs.keys()])
for i in pkgs.keys():
    children = sorted([k for k in pkgs.keys() if k.startswith(f"{i}/") and ("/" not in k[len(i)+1:])])

    with open(f"{i}/__init__.py", "a") as init:

        init.write("\n\n__all__ = [\n")
        for cls in sorted(pkgs[i], key=lambda x: x.__name__):
            init.write(f"    '{cls.__name__}',\n")
        for c in children:
            init.write(f"    '{c.split('/')[-1]}',\n")
        init.write("]")

        if children:
            init.write("\n\n")
            for c in children:
                init.write(f"from plotly.{i.replace('/','.')} import {c.split('/')[-1]}\n")


