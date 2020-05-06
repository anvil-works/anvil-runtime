
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.annotation"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.layout.annotation"


__all__ = [
    'Font',
    'Hoverlabel',
    'hoverlabel',
]

from plotly.graph_objs.layout.annotation import hoverlabel
