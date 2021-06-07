
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Funnel(WrappedObject):
    _name = "Funnel"
    _module = "plotly.graph_objs._funnel"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='funnel', **kwargs)
