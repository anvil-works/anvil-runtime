
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Caps(WrappedObject):
    _name = "Caps"
    _module = "plotly.graph_objs.volume"

@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Contour(WrappedObject):
    _name = "Contour"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Lighting(WrappedObject):
    _name = "Lighting"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Lightposition(WrappedObject):
    _name = "Lightposition"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Slices(WrappedObject):
    _name = "Slices"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Spaceframe(WrappedObject):
    _name = "Spaceframe"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.volume"

@serializable_type
class Surface(WrappedObject):
    _name = "Surface"
    _module = "plotly.graph_objs.volume"


__all__ = [
    'Caps',
    'ColorBar',
    'Contour',
    'Hoverlabel',
    'Lighting',
    'Lightposition',
    'Slices',
    'Spaceframe',
    'Stream',
    'Surface',
    'caps',
    'colorbar',
    'hoverlabel',
    'slices',
]

from plotly.graph_objs.volume import caps
from plotly.graph_objs.volume import colorbar
from plotly.graph_objs.volume import hoverlabel
from plotly.graph_objs.volume import slices
