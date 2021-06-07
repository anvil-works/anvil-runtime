
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scattercarpet(WrappedObject):
    _name = "Scattercarpet"
    _module = "plotly.graph_objs._scattercarpet"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattercarpet', **kwargs)
