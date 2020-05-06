
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.image"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.image"


__all__ = [
    'Hoverlabel',
    'Stream',
    'hoverlabel',
]

from plotly.graph_objs.image import hoverlabel
