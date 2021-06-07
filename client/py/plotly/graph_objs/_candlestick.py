
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Candlestick(WrappedObject):
    _name = "Candlestick"
    _module = "plotly.graph_objs._candlestick"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='candlestick', **kwargs)
