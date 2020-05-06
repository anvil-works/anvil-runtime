
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.contourcarpet"

@serializable_type
class Contours(WrappedObject):
    _name = "Contours"
    _module = "plotly.graph_objs.contourcarpet"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.contourcarpet"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.contourcarpet"


__all__ = [
    'ColorBar',
    'Contours',
    'Line',
    'Stream',
    'colorbar',
    'contours',
]

from plotly.graph_objs.contourcarpet import colorbar
from plotly.graph_objs.contourcarpet import contours
