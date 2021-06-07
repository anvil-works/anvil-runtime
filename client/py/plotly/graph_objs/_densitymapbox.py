
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Densitymapbox(WrappedObject):
    _name = "Densitymapbox"
    _module = "plotly.graph_objs._densitymapbox"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='densitymapbox', **kwargs)
