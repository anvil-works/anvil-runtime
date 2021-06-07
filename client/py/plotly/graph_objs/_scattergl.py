
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scattergl(WrappedObject):
    _name = "Scattergl"
    _module = "plotly.graph_objs._scattergl"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattergl', **kwargs)
