# Classes in plotly that have additional behaviour and features

from anvil.util import WrappedObject

_valid_underscore_properties = {
    "error_x": "error-x",
    "error_y": "error-y",
    "error_z": "error-z",
    "copy_xstyle": "copy-xstyle",
    "copy_ystyle": "copy-ystyle",
    "copy_zstyle": "copy-zstyle",
    "paper_bgcolor": "paper-bgcolor",
    "plot_bgcolor": "plot-bgcolor",
}


def _get_props(full_path):
    for under_prop, hyphen_prop in _valid_underscore_properties.items():
        full_path = full_path.replace(under_prop, hyphen_prop)
    
    props = full_path.split("_")
    for i, prop in enumerate(props):
        props[i] = prop.replace("-", "_")
    
    return props

def _walk_props(self, path, props):
    res = self
    for p in props:
        try:
            res = WrappedObject.__getitem__(res, p)
        except TypeError:
            raise KeyError(path)
    return res

# support: https://plotly.com/python/creating-and-updating-figures/#magic-underscore-notation
class Base(WrappedObject):
    def __setitem__(self, path, val):
        if path[0] != "_" and "_" in path[1:]:
            props = _get_props(path)
            res = _walk_props(self, path, props[:-1])
            WrappedObject.__setitem__(res, props[-1], val)
        else:
            return WrappedObject.__setitem__(self, path, val)

    def __getitem__(self, path):
        if path[0] != "_" and "_" in path[1:]:
            props = _get_props(path)
            return _walk_props(self, path, props)
        else:
            return WrappedObject.__getitem__(self, path)
        


def _not_implemented_wrapper(cls_name, name):
    def not_implemented(self, *args, **kws):
        raise NotImplementedError(name + " is not yet implemented")

    not_implemented.__name__ = name
    not_implemented.__qualname__ = cls_name + "." + name

    return not_implemented


class Figure(Base):
    _name = "Figure"
    def __init__(self, data=None, layout=None, **kws):
        if isinstance(data, Figure):
            data, layout = data.data, data.layout
        elif type(data) is dict and ("data" in data or "layout" in data):
            # Extract data, layout, and frames
            data, layout = (
                data.get("data", None),
                data.get("layout", None),
            )

        if data is None:
            data = []
        elif not isinstance(data, (list, tuple)):
            data = [data]

        if layout is None:
            layout = {}
        elif isinstance(layout, dict):
            layout = dict(layout)
            template = self._initialize_template(layout.get("template", None))
            if template is not None:
                layout["template"] = template

        Base.__init__(self, data=data, layout=layout, **kws)

    # some common methods we don't support
    update_traces = _not_implemented_wrapper("Figure", "update_traces")
    add_trace = _not_implemented_wrapper("Figure", "add_trace")
    for_each_trace = _not_implemented_wrapper("Figure", "for_each_trace")

    def update_layout(self, dict1=None, **kws):
        dict1 = dict1 or {}
        self.layout.update(dict1, **kws)
        return self

    _default_template = None

    def _get_template(self, template):
        return template

    def _initialize_template(self, template):
        if template is None:
            template = self._default_template
        
        if type(template) is str:
            return self._get_template(template)

        return template


_overrides = {"plotly.graph_objs._figure.Figure": Figure}
