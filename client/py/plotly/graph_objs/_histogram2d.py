
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Histogram2d(WrappedObject):
    _name = "Histogram2d"
    _module = "plotly.graph_objs._histogram2d"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram2d', **kwargs)
