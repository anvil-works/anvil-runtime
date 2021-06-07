
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scatterpolar(WrappedObject):
    _name = "Scatterpolar"
    _module = "plotly.graph_objs._scatterpolar"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterpolar', **kwargs)
