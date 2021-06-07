
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Contourcarpet(WrappedObject):
    _name = "Contourcarpet"
    _module = "plotly.graph_objs._contourcarpet"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='contourcarpet', **kwargs)
