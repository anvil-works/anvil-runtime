
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scatter3d(WrappedObject):
    _name = "Scatter3d"
    _module = "plotly.graph_objs._scatter3d"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatter3d', **kwargs)
