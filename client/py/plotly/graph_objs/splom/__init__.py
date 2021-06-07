
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Diagonal(WrappedObject):
    _name = "Diagonal"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Dimension(WrappedObject):
    _name = "Dimension"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Selected(WrappedObject):
    _name = "Selected"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.splom"

@serializable_type
class Unselected(WrappedObject):
    _name = "Unselected"
    _module = "plotly.graph_objs.splom"


__all__ = [
    'Diagonal',
    'Dimension',
    'Hoverlabel',
    'Marker',
    'Selected',
    'Stream',
    'Transform',
    'Unselected',
    'dimension',
    'hoverlabel',
    'marker',
    'selected',
    'unselected',
]

from plotly.graph_objs.splom import dimension
from plotly.graph_objs.splom import hoverlabel
from plotly.graph_objs.splom import marker
from plotly.graph_objs.splom import selected
from plotly.graph_objs.splom import unselected
