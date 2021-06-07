
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.heatmapgl"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.heatmapgl"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.heatmapgl"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.heatmapgl"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Stream',
    'Transform',
    'colorbar',
    'hoverlabel',
]

from plotly.graph_objs.heatmapgl import colorbar
from plotly.graph_objs.heatmapgl import hoverlabel
