import plotly.graph_objs as go

try:
    _TemplateFactory = go.layout.Template
except AttributeError:
    _TemplateFactory = dict


_cache = {}


def _get_pio():
    try:
        import plotly.io as pio
    except ImportError:
        return None
    else:
        return pio


def _resolve_theme_alias(theme):
    if theme == "rally":
        return "rally_dark"
    return theme


def _register_template(name, defn):
    pio = _get_pio()
    if pio is None:
        return

    if name not in pio.templates:
        pio.templates[name] = _TemplateFactory(**defn)


class Templates:
    def __getitem__(self, theme):
        theme = _resolve_theme_alias(theme)
        try:
            return _cache[theme]
        except KeyError:
            pass

        import os
        import json

        current_dir = os.path.dirname(os.path.realpath(__file__))
        file_path = os.path.join(current_dir, "templates", theme + ".json")

        try:
            with open(file_path, "r") as file:
                data = json.load(file)
        except Exception:
            raise KeyError(theme)
        else:
            # Plotly.py 7 removed Mapbox classes. Keep the shared theme files
            # usable by older servers and adapt them only for the new schema.
            if not hasattr(go, "Scattermapbox"):
                trace_defaults = data.get("data", {})
                if "scattermapbox" in trace_defaults:
                    trace_defaults["scattermap"] = trace_defaults.pop("scattermapbox")
                    for trace in trace_defaults["scattermap"]:
                        trace["type"] = "scattermap"
                layout_defaults = data.get("layout", {})
                if "mapbox" in layout_defaults:
                    layout_defaults["map"] = layout_defaults.pop("mapbox")
            _cache[theme] = data
            _register_template(theme, data)

        return data

    def __getattr__(self, theme):
        try:
            return self[theme]
        except KeyError:
            raise AttributeError(theme)


#!defModuleAttr(anvil.plotly_templates)!1: {name: "templates", type: "dict", description: "A dictionary of custom templates for anvil themes"}
templates = Templates()


#!defFunction(anvil.plotly_templates,_,template)!2: "Sets the default plotly template" ["set_default"]
def set_default(template):
    pio = _get_pio()
    template = _resolve_theme_alias(template)

    if pio is None:
        go.Figure._default_template = template
    elif type(template) is str:
        templates[template]
        pio.templates.default = template
    else:
        pio.templates.default = template


def _get_template(self, template):
    return templates[template]


go.Figure._get_template = _get_template
