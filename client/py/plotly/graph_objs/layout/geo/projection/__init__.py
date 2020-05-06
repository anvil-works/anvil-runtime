
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Rotation(WrappedObject):
    _name = "Rotation"
    _module = "plotly.graph_objs.layout.geo.projection"


__all__ = [
    'Rotation',
]