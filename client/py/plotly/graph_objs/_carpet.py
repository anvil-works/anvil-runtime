
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Carpet(WrappedObject):
    _name = "Carpet"
    _module = "plotly.graph_objs._carpet"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='carpet', **kwargs)
