#!python

## NEW SCRIPT - Generate stub plotly package based on JSON schema.
import json
import sys
import requests
from collections import defaultdict
import os

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
os.chdir(SCRIPT_DIR)

OUT_DIR = "../client/py"
TEMPLATE_DIR = "../client/js/lib/templates"
LIB_DIR = "../client/js/lib"

PYVERSION = "5.13.1"
VERSION = (
    "2.18.2"  # JS version - should match current python version (find package.json in github.com/plotly/plotly.py)
)
SCHEMA_URL = f"https://raw.githubusercontent.com/plotly/plotly.js/v{VERSION}/dist/plot-schema.json"

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


required_classes = {}  # {leaf: {"a": class_names[], "t": trace_type_classe_names[], "c": {leaf: {...}}}}

types = cdict()  # Module --> class type


def add_type(module_name, class_name, obj):
    module_name = module_name
    full_name = module_name + "." + class_name
    types[module_name]["name"] = module_name
    types[module_name]["$id"] = module_name

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
                    attr, spec = list(spec.get("items").items())[0]

                instance_attrs[attr] = {"$ref": full_name.lower() + "." + class_nameify(attr) + " instance"}
            constructor_args.append(
                {
                    "name": attr,
                    "type": "keyword",
                    "optional": True,
                    "docString": spec.get("description"),
                }
            )

    types[module_name]["attrs"][class_name] = {
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
            },
        },
        "isBuiltin": True,
    }


def class_nameify(name):
    return OBJECT_NAME_TO_CLASS_NAME.get(name, name.title().replace("_", ""))


def walk_attrs(path, attrs, req):
    for k, v in attrs.items():
        if isinstance(v, dict) and k != "_deprecated":
            if v.get("role") == "object":
                # This is going to be a class in the end
                if v.get("items"):
                    k, v = list(v["items"].items())[0]
                name = class_nameify(k)
                add_type(path, name, v)
                path_leaf = path.split(".").pop()
                d = req.setdefault(path_leaf, {"a": [], "c": {}})
                d["a"].append(name)
                walk_attrs(f"{path}.{k}", v, d["c"])
            else:
                # This isn't going to be a class, it's just a value type.
                # We may want to get cleverer and include docs or something.
                pass


top_level_classes = []


def load_trace(trace_schema):
    walk_attrs(f"plotly.graph_objs.{trace_schema['type']}", trace_schema["attributes"], required_classes)
    name = class_nameify(trace_schema["type"])
    top_level_classes.append(name)
    add_type("plotly.graph_objs", name, trace_schema["attributes"])
    # these are trace_types
    required_classes[f"_{trace_schema['type']}"] = {"t": [name]}


def load_layout(layout_schema):
    walk_attrs(f"plotly.graph_objs.layout", layout_schema["layoutAttributes"], required_classes)
    top_level_classes.append("Layout")
    add_type("plotly.graph_objs", "Layout", layout_schema["layoutAttributes"])
    required_classes["_layout"] = {"a": ["Layout"]}


def walk_leaf_modules(modname, schema):
    child_modules = schema.get("c")

    if child_modules is None:
        return

    if not child_modules:
        del schema["c"]
        return

    for leaf_name, s in child_modules.items():
        if leaf_name.startswith("_"):
            continue
        child_modname = f"{modname}.{leaf_name}"
        types[modname]["attrs"][leaf_name] = {"$ref": child_modname}
        walk_leaf_modules(child_modname, s)


for name, trace in schema["traces"].items():
    load_trace(trace)

load_layout(schema["layout"])

required_classes["_deprecations"] = {"a": []}

for cls in DEPRECATED_DATATYPES.keys():
    required_classes["_deprecations"]["a"].append(cls)


top_level_classes.append("Figure")
add_type("plotly.graph_objs", "Figure", {})
required_classes["_figure"] = {"a": ["Figure"]}

types["plotly.graph_objects"] = {
    "name": "plotly.graph_objects",
    "$ref": "plotly.graph_objs",
}

walk_leaf_modules("plotly.graph_objs", {"c": required_classes})

os.chdir(OUT_DIR)

with open("plotly/_schema.py", "w") as file:
    _required_classes = dict(required_classes)
    _required_classes = repr(_required_classes).replace(" ", "")
    file.write(f"schema={_required_classes}")


os.chdir(SCRIPT_DIR)
with open("plotly-types.json", "w") as f:
    json.dump(types, f)


def write_templates():
    os.chdir(TEMPLATE_DIR)

    # specify the URL of the GitHub directory
    url = f"https://github.com/plotly/plotly.py/tree/v{PYVERSION}/packages/python/plotly/plotly/package_data/templates"

    # send a GET request to the URL
    response = requests.get(url)
    if response.status_code != 200:
        print("Failed to load templates")

    for line in response.text.splitlines():
        if "href=" not in line and ".json" not in line:
            continue

        file_path = line.split('href="', 1)[1].split('"', 1)[0]

        if not (file_path.startswith("/plotly") and file_path.endswith(".json")):
            continue

        file_url = "https://raw.githubusercontent.com" + file_path.replace("/blob/", "/")
        file_response = requests.get(file_url)

        if file_response.status_code != 200:
            print("Failed to fetch " + file_path)
            continue

        file_name = file_path.rsplit("/", 1)[1]

        with open(file_name, "w") as file:
            file.write(file_response.text)


def update_plotly_min():
    os.chdir(LIB_DIR)
    url = f"https://raw.githubusercontent.com/plotly/plotly.js/v{VERSION}/dist/plotly.min.js"
    response = requests.get(url)
    if response.status_code != 200:
        print("Failed to load plotly.min.js")

    with open("plotly-latest.min.js", "w") as f:
        f.write(response.text)


write_templates()
os.chdir(SCRIPT_DIR)
update_plotly_min()
