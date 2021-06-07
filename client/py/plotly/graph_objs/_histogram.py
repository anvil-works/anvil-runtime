
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Histogram(WrappedObject):
    _name = "Histogram"
    _module = "plotly.graph_objs._histogram"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram', **kwargs)
