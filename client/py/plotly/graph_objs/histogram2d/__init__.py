
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.histogram2d"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.histogram2d"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.histogram2d"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.histogram2d"

@serializable_type
class XBins(WrappedObject):
    _name = "XBins"
    _module = "plotly.graph_objs.histogram2d"

@serializable_type
class YBins(WrappedObject):
    _name = "YBins"
    _module = "plotly.graph_objs.histogram2d"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Marker',
    'Stream',
    'XBins',
    'YBins',
    'colorbar',
    'hoverlabel',
]

from plotly.graph_objs.histogram2d import colorbar
from plotly.graph_objs.histogram2d import hoverlabel
