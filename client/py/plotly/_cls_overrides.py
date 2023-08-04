# Classes in plotly that have additional behaviour and features

from anvil.util import WrappedObject


def _not_implemented_wrapper(cls_name, name):
    def not_implemented(self, *args, **kws):
        raise NotImplementedError(name + " is not yet implemented")

    not_implemented.__name__ = name
    not_implemented.__qualname__ = cls_name + "." + name

    return not_implemented


class Figure(WrappedObject):
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

        WrappedObject.__init__(self, data=data, layout=layout, **kws)

    # some common methods we don't support
    update_traces = _not_implemented_wrapper("Figure", "update_traces")
    add_trace = _not_implemented_wrapper("Figure", "add_trace")
    for_each_trace = _not_implemented_wrapper("Figure", "for_each_trace")

    def update_layout(self, dict1=None, **kws):
        dict1 = dict1 or {}
        self.layout.update(dict1, **kws)
        return self


_overrides = {"plotly.graph_objs._figure.Figure": Figure}
