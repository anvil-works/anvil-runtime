
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scatterpolargl(WrappedObject):
    _name = "Scatterpolargl"
    _module = "plotly.graph_objs._scatterpolargl"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterpolargl', **kwargs)
