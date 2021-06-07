
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Indicator(WrappedObject):
    _name = "Indicator"
    _module = "plotly.graph_objs._indicator"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='indicator', **kwargs)
