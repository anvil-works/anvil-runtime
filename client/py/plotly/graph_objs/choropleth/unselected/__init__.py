
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.choropleth.unselected"


__all__ = [
    'Marker',
]