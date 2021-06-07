
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Funnelarea(WrappedObject):
    _name = "Funnelarea"
    _module = "plotly.graph_objs._funnelarea"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='funnelarea', **kwargs)
