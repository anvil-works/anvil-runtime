
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Barpolar(WrappedObject):
    _name = "Barpolar"
    _module = "plotly.graph_objs._barpolar"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='barpolar', **kwargs)
