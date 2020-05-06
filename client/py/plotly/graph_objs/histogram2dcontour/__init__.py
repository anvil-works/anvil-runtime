
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class Contours(WrappedObject):
    _name = "Contours"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class XBins(WrappedObject):
    _name = "XBins"
    _module = "plotly.graph_objs.histogram2dcontour"

@serializable_type
class YBins(WrappedObject):
    _name = "YBins"
    _module = "plotly.graph_objs.histogram2dcontour"


__all__ = [
    'ColorBar',
    'Contours',
    'Hoverlabel',
    'Line',
    'Marker',
    'Stream',
    'XBins',
    'YBins',
    'colorbar',
    'contours',
    'hoverlabel',
]

from plotly.graph_objs.histogram2dcontour import colorbar
from plotly.graph_objs.histogram2dcontour import contours
from plotly.graph_objs.histogram2dcontour import hoverlabel
