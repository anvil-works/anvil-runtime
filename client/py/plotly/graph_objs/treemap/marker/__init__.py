
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.treemap.marker"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.treemap.marker"

@serializable_type
class Pad(WrappedObject):
    _name = "Pad"
    _module = "plotly.graph_objs.treemap.marker"


__all__ = [
    'ColorBar',
    'Line',
    'Pad',
    'colorbar',
]

from plotly.graph_objs.treemap.marker import colorbar
