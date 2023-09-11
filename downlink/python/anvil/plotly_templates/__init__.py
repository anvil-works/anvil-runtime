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


def _register_template(name, defn):
    pio = _get_pio()
    if pio is None:
        return
    
    if name not in pio.templates:
        pio.templates[name] = _TemplateFactory(**defn)



class Templates:
    def __getitem__(self, theme):
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
