#!python

## NEW SCRIPT - Generate stub plotly package based on JSON schema.
import json
import sys
import requests
from collections import defaultdict
import os

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
os.chdir(SCRIPT_DIR)

OUT_DIR="../client/py"

SCHEMA_URL = "https://raw.githubusercontent.com/plotly/plotly.js/master/dist/plot-schema.json"

# Copied from https://github.com/plotly/plotly.py
# packages/python/plotly/codegen/utils.py#L1026
OBJECT_NAME_TO_CLASS_NAME = {
    "angularaxis": "AngularAxis",
    "colorbar": "ColorBar",
    "error_x": "ErrorX",
    "error_y": "ErrorY",
    "error_z": "ErrorZ",
    "histogram2d": "Histogram2d",
    "histogram2dcontour": "Histogram2dContour",
    "mesh3d": "Mesh3d",
    "radialaxis": "RadialAxis",
    "scatter3d": "Scatter3d",
    "xaxis": "XAxis",
    "xbins": "XBins",
    "yaxis": "YAxis",
    "ybins": "YBins",
    "zaxis": "ZAxis",
}

# Copied from https://github.com/plotly/plotly.py
# packages/python/plotly/codegen/compatibility.py
DEPRECATED_DATATYPES = {
    # List types
    "Data": {"base_type": list, "new": ["Scatter", "Bar", "Area", "Histogram", "etc."]},
    "Annotations": {
        "base_type": list,
        "new": ["layout.Annotation", "layout.scene.Annotation"],
    },
    "Frames": {"base_type": list, "new": ["Frame"]},
    # Dict types
    "AngularAxis": {"base_type": dict, "new": ["layout", "layout.polar"]},
    "Annotation": {"base_type": dict, "new": ["layout", "layout.scene"]},
    "ColorBar": {"base_type": dict, "new": ["scatter.marker", "surface", "etc."]},
    "Contours": {"base_type": dict, "new": ["contour", "surface", "etc."]},
    "ErrorX": {"base_type": dict, "new": ["scatter", "histogram", "etc."]},
    "ErrorY": {"base_type": dict, "new": ["scatter", "histogram", "etc."]},
    "ErrorZ": {"base_type": dict, "new": ["scatter3d"]},
    "Font": {"base_type": dict, "new": ["layout", "layout.hoverlabel", "etc."]},
    "Legend": {"base_type": dict, "new": ["layout"]},
    "Line": {"base_type": dict, "new": ["scatter", "layout.shape", "etc."]},
    "Margin": {"base_type": dict, "new": ["layout"]},
    "Marker": {"base_type": dict, "new": ["scatter", "histogram.selected", "etc."]},
    "RadialAxis": {"base_type": dict, "new": ["layout", "layout.polar"]},
    "Scene": {"base_type": dict, "new": ["layout"]},
    "Stream": {"base_type": dict, "new": ["scatter", "area"]},
    "XAxis": {"base_type": dict, "new": ["layout", "layout.scene"]},
    "YAxis": {"base_type": dict, "new": ["layout", "layout.scene"]},
    "ZAxis": {"base_type": dict, "new": ["layout.scene"]},
    "XBins": {"base_type": dict, "new": ["histogram", "histogram2d"]},
    "YBins": {"base_type": dict, "new": ["histogram", "histogram2d"]},
    "Trace": {
        "base_type": dict,
        "new": ["Scatter", "Bar", "Area", "Histogram", "etc."],
    },
    "Histogram2dcontour": {"base_type": dict, "new": ["Histogram2dContour"]},
}


schema = requests.get(SCHEMA_URL).json()


def cdict():
    return defaultdict(cdict)


required_classes = cdict()  # File --> class def

types = cdict()  # Module --> class type


def add_type(module_name, class_name, obj):
    module_name = module_name
    full_name = module_name + "." + class_name
    types[module_name]['name'] = module_name
    types[module_name]['$id'] = module_name

    instance_attrs = {}
    constructor_args = []
    for attr, spec in obj.items():
        if isinstance(spec, dict):
            if spec.get("valType"):
                instance_attrs[attr] = {
                    "name": spec.get("valType"),
                    "docString": spec.get("description"),
                }
            elif spec.get("role") == "object":
                if spec.get("items"):
                    attr,spec = list(spec.get("items").items())[0]

                instance_attrs[attr] = {
                    "$ref": full_name.lower() + "." + class_nameify(attr) + " instance"
                }
            constructor_args.append({
                "name": attr,
                "type": "keyword",
                "optional": True,
                "docString": spec.get("description"),
            })


    types[module_name]['attrs'][class_name] = {
        "$id": full_name,
        "name": full_name,
        "docString": "Create a new '" + class_name + "' object",
        "attrs": {},
        "callable": {
            "args": constructor_args,
            "returns": {
                "$id": full_name + " instance",
                "name": class_name,
                "attrs": instance_attrs,
                "isBuiltin": True,
                "docString": obj.get("description", ""),
            }
        },
        "isBuiltin": True,
    }


def class_nameify(name):
    return OBJECT_NAME_TO_CLASS_NAME.get(name, name.title().replace("_",""))


def walk_attrs(path, attrs):
    for k, v in attrs.items():
        if isinstance(v, dict) and k != "_deprecated":
            if v.get("role") == "object":
                # This is going to be a class in the end
                if v.get("items"):
                    k,v = list(v.get("items").items())[0]
                name = class_nameify(k)
                add_type(path, name, v)
                required_classes[path.replace(".","/") + "/__init__.py"][name] = {
                    "name": name,
                    "module": path
                }
                walk_attrs(f"{path}.{k}", v)
            else:
                # This isn't going to be a class, it's just a value type.
                # We may want to get cleverer and include docs or something.
                pass


top_level_classes = []


def load_trace(trace_schema):
    walk_attrs(f"plotly.graph_objs.{trace_schema['type']}", trace_schema['attributes'])
    name = class_nameify(trace_schema['type'])
    top_level_classes.append(name)
    add_type("plotly.graph_objs", name, trace_schema['attributes'])
    required_classes[f"plotly/graph_objs/_{trace_schema['type']}.py"][name] = {
        "name": name,
        "module": f"plotly.graph_objs._{trace_schema['type']}",
        "trace_type": trace_schema['type'],
    }


def load_layout(layout_schema):
    walk_attrs(f"plotly.graph_objs.layout", layout_schema['layoutAttributes'])
    top_level_classes.append("Layout")
    add_type("plotly.graph_objs", "Layout", layout_schema['layoutAttributes'])
    required_classes["plotly/graph_objs/_layout.py"]["Layout"] = {
        "name": "Layout",
        "module": "plotly.graph_objs._layout",
    }


for name, trace in schema['traces'].items():
    load_trace(trace)

load_layout(schema['layout'])

for cls in DEPRECATED_DATATYPES.keys():
    required_classes["plotly/graph_objs/_deprecations.py"][cls] = {
        "name": cls,
        "module": "plotly.graph_objs._deprecations",
    }


top_level_classes.append("Figure")
add_type("plotly.graph_objs", "Figure", {})
required_classes["plotly/graph_objs/_figure.py"]["Figure"] = {
    "name": "Figure",
    "module": "plotly.graph_objs._figure",
    "trace_type": "figure",
}

required_classes['plotly/graph_objs/__init__.py'] = {}
types["plotly.graph_objects"] = {
    "name": "plotly.graph_objects",
    "$ref": "plotly.graph_objs",
}
os.chdir(OUT_DIR)
try:
    os.rmdir("plotly/graph_objs")
except:
    pass

for path, classes in required_classes.items():
    os.makedirs(os.path.dirname(path),exist_ok=True)
    with open(path, "w") as file:
        file.write("""
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type

""")
        for class_name, cls in sorted(classes.items(), key=lambda x: x[0]):
            file.write(f"""
@serializable_type
class {class_name}(WrappedObject):
    _name = "{cls['name']}"
    _module = "{cls['module']}"
""")

            if cls.get('trace_type'):
                file.write(f"""
    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='{cls['trace_type']}', **kwargs)
""")

        if os.path.basename(path) == "__init__.py":
            file.write(f"""

__all__ = [
""")

            if path == "plotly/graph_objs/__init__.py":
                for class_name in sorted(top_level_classes):
                    file.write(f"    '{class_name}',\n")

            for class_name in sorted(classes.keys()):
                file.write(f"    '{class_name}',\n")

            nested = sorted(set([file_path[len(os.path.dirname(path))+1:].split("/")[0] for file_path in required_classes.keys() if os.path.dirname(file_path).startswith(os.path.dirname(path) + "/")]))
            nested = [n for n in nested if n != "" and n != "__init__.py" and n != "_deprecations.py"]

            for p in nested:
                file.write(f"    '{p}',\n")

            file.write("]")

            if path == "plotly/graph_objs/__init__.py":
                file.write("\n\n")
                for cls in sorted(DEPRECATED_DATATYPES.keys()):
                    file.write(f"from {os.path.dirname(path).replace('/','.')}._deprecations import {cls}\n")
                for cls in sorted(top_level_classes):
                    file.write(f"from {os.path.dirname(path).replace('/','.')}._{cls.lower()} import {cls}\n")

            if nested:
                file.write("\n\n")
                for p in nested:
                    file.write(f"from {os.path.dirname(path).replace('/','.')} import {p}\n")

            if nested:
                module_name = os.path.dirname(path).replace("/",".")
                for n in nested:
                    types[module_name]['attrs'][n] = {
                        "$ref": module_name + "." + n,
                    }


os.chdir(SCRIPT_DIR)
with open("plotly-types.json","w") as f:
    json.dump(types, f)
