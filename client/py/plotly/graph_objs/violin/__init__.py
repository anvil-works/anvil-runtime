
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Box(WrappedObject):
    _name = "Box"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Meanline(WrappedObject):
    _name = "Meanline"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Selected(WrappedObject):
    _name = "Selected"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.violin"

@serializable_type
class Unselected(WrappedObject):
    _name = "Unselected"
    _module = "plotly.graph_objs.violin"


__all__ = [
    'Box',
    'Hoverlabel',
    'Line',
    'Marker',
    'Meanline',
    'Selected',
    'Stream',
    'Unselected',
    'box',
    'hoverlabel',
    'marker',
    'selected',
    'unselected',
]

from plotly.graph_objs.violin import box
from plotly.graph_objs.violin import hoverlabel
from plotly.graph_objs.violin import marker
from plotly.graph_objs.violin import selected
from plotly.graph_objs.violin import unselected
