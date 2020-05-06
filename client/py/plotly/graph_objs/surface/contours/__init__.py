
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class X(WrappedObject):
    _name = "X"
    _module = "plotly.graph_objs.surface.contours"

@serializable_type
class Y(WrappedObject):
    _name = "Y"
    _module = "plotly.graph_objs.surface.contours"

@serializable_type
class Z(WrappedObject):
    _name = "Z"
    _module = "plotly.graph_objs.surface.contours"


__all__ = [
    'X',
    'Y',
    'Z',
    'x',
    'y',
    'z',
]

from plotly.graph_objs.surface.contours import x
from plotly.graph_objs.surface.contours import y
from plotly.graph_objs.surface.contours import z
