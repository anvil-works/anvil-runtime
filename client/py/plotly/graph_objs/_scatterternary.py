
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scatterternary(WrappedObject):
    _name = "Scatterternary"
    _module = "plotly.graph_objs._scatterternary"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterternary', **kwargs)
