
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Center(WrappedObject):
    _name = "Center"
    _module = "plotly.graph_objs.layout.mapbox"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.layout.mapbox"

@serializable_type
class Layer(WrappedObject):
    _name = "Layer"
    _module = "plotly.graph_objs.layout.mapbox"


__all__ = [
    'Center',
    'Domain',
    'Layer',
    'layer',
]

from plotly.graph_objs.layout.mapbox import layer
