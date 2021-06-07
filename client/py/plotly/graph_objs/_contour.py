
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Contour(WrappedObject):
    _name = "Contour"
    _module = "plotly.graph_objs._contour"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='contour', **kwargs)
