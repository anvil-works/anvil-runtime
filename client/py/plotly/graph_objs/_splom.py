
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Splom(WrappedObject):
    _name = "Splom"
    _module = "plotly.graph_objs._splom"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='splom', **kwargs)
