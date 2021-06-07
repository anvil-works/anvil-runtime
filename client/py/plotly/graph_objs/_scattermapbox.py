
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Scattermapbox(WrappedObject):
    _name = "Scattermapbox"
    _module = "plotly.graph_objs._scattermapbox"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattermapbox', **kwargs)
