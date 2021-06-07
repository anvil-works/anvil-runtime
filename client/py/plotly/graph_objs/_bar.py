
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Bar(WrappedObject):
    _name = "Bar"
    _module = "plotly.graph_objs._bar"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='bar', **kwargs)
