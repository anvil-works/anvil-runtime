
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Cone(WrappedObject):
    _name = "Cone"
    _module = "plotly.graph_objs._cone"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='cone', **kwargs)
