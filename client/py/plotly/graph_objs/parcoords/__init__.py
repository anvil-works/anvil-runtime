
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Dimension(WrappedObject):
    _name = "Dimension"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Labelfont(WrappedObject):
    _name = "Labelfont"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Rangefont(WrappedObject):
    _name = "Rangefont"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Tickfont(WrappedObject):
    _name = "Tickfont"
    _module = "plotly.graph_objs.parcoords"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.parcoords"


__all__ = [
    'Dimension',
    'Domain',
    'Labelfont',
    'Line',
    'Rangefont',
    'Stream',
    'Tickfont',
    'Transform',
    'line',
]

from plotly.graph_objs.parcoords import line
