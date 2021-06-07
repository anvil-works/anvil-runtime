
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Waterfall(WrappedObject):
    _name = "Waterfall"
    _module = "plotly.graph_objs._waterfall"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='waterfall', **kwargs)
