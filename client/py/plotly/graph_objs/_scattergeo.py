
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scattergeo(WrappedObject):
    _name = "Scattergeo"
    _module = "plotly.graph_objs._scattergeo"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattergeo', **kwargs)
