
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Box(WrappedObject):
    _name = "Box"
    _module = "plotly.graph_objs._box"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='box', **kwargs)
