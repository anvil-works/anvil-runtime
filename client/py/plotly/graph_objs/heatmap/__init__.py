
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.heatmap"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.heatmap"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.heatmap"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Stream',
    'colorbar',
    'hoverlabel',
]

from plotly.graph_objs.heatmap import colorbar
from plotly.graph_objs.heatmap import hoverlabel
