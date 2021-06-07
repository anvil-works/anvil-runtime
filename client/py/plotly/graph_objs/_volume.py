
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Volume(WrappedObject):
    _name = "Volume"
    _module = "plotly.graph_objs._volume"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='volume', **kwargs)
