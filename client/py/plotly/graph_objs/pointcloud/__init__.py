
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.pointcloud"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.pointcloud"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.pointcloud"


__all__ = [
    'Hoverlabel',
    'Marker',
    'Stream',
    'hoverlabel',
    'marker',
]

from plotly.graph_objs.pointcloud import hoverlabel
from plotly.graph_objs.pointcloud import marker
