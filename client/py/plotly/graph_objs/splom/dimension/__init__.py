
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Axis(WrappedObject):
    _name = "Axis"
    _module = "plotly.graph_objs.splom.dimension"


__all__ = [
    'Axis',
]