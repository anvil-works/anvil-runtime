
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Histogram2dContour(WrappedObject):
    _name = "Histogram2dContour"
    _module = "plotly.graph_objs._histogram2dcontour"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram2dcontour', **kwargs)
