
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.parcats.line"


__all__ = [
    'ColorBar',
    'colorbar',
]

from plotly.graph_objs.parcats.line import colorbar
