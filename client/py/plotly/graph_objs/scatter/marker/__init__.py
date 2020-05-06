
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.scatter.marker"

@serializable_type
class Gradient(WrappedObject):
    _name = "Gradient"
    _module = "plotly.graph_objs.scatter.marker"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.scatter.marker"


__all__ = [
    'ColorBar',
    'Gradient',
    'Line',
    'colorbar',
]

from plotly.graph_objs.scatter.marker import colorbar
