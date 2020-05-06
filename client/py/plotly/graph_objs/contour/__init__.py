
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.contour"

@serializable_type
class Contours(WrappedObject):
    _name = "Contours"
    _module = "plotly.graph_objs.contour"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.contour"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.contour"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.contour"


__all__ = [
    'ColorBar',
    'Contours',
    'Hoverlabel',
    'Line',
    'Stream',
    'colorbar',
    'contours',
    'hoverlabel',
]

from plotly.graph_objs.contour import colorbar
from plotly.graph_objs.contour import contours
from plotly.graph_objs.contour import hoverlabel
