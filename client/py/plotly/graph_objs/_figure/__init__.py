
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Figure(WrappedObject):
    _name = "Figure"
    _module = "plotly.graph_objs._figure"


__all__ = [
    'Figure',
]