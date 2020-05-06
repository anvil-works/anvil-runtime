
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class YAxis(WrappedObject):
    _name = "YAxis"
    _module = "plotly.graph_objs.layout.xaxis.rangeslider"


__all__ = [
    'YAxis',
]