
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Sankey(WrappedObject):
    _name = "Sankey"
    _module = "plotly.graph_objs._sankey"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='sankey', **kwargs)
