
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Border(WrappedObject):
    _name = "Border"
    _module = "plotly.graph_objs.pointcloud.marker"


__all__ = [
    'Border',
]