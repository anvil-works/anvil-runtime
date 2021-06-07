
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.barpolar"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.barpolar"

@serializable_type
class Selected(WrappedObject):
    _name = "Selected"
    _module = "plotly.graph_objs.barpolar"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.barpolar"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.barpolar"

@serializable_type
class Unselected(WrappedObject):
    _name = "Unselected"
    _module = "plotly.graph_objs.barpolar"


__all__ = [
    'Hoverlabel',
    'Marker',
    'Selected',
    'Stream',
    'Transform',
    'Unselected',
    'hoverlabel',
    'marker',
    'selected',
    'unselected',
]

from plotly.graph_objs.barpolar import hoverlabel
from plotly.graph_objs.barpolar import marker
from plotly.graph_objs.barpolar import selected
from plotly.graph_objs.barpolar import unselected
