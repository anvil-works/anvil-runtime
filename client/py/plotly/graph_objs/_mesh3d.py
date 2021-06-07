
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Mesh3d(WrappedObject):
    _name = "Mesh3d"
    _module = "plotly.graph_objs._mesh3d"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='mesh3d', **kwargs)
