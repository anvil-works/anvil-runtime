
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.waterfall.totals.marker"


__all__ = [
    'Line',
]