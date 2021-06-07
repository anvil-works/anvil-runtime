
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ErrorX(WrappedObject):
    _name = "ErrorX"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class ErrorY(WrappedObject):
    _name = "ErrorY"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class ErrorZ(WrappedObject):
    _name = "ErrorZ"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Projection(WrappedObject):
    _name = "Projection"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.scatter3d"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.scatter3d"


__all__ = [
    'ErrorX',
    'ErrorY',
    'ErrorZ',
    'Hoverlabel',
    'Line',
    'Marker',
    'Projection',
    'Stream',
    'Textfont',
    'Transform',
    'hoverlabel',
    'line',
    'marker',
    'projection',
]

from plotly.graph_objs.scatter3d import hoverlabel
from plotly.graph_objs.scatter3d import line
from plotly.graph_objs.scatter3d import marker
from plotly.graph_objs.scatter3d import projection
