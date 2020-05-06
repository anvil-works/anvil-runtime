
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.cone"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.cone"

@serializable_type
class Lighting(WrappedObject):
    _name = "Lighting"
    _module = "plotly.graph_objs.cone"

@serializable_type
class Lightposition(WrappedObject):
    _name = "Lightposition"
    _module = "plotly.graph_objs.cone"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.cone"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Lighting',
    'Lightposition',
    'Stream',
    'colorbar',
    'hoverlabel',
]

from plotly.graph_objs.cone import colorbar
from plotly.graph_objs.cone import hoverlabel
