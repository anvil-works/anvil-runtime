
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Pie(WrappedObject):
    _name = "Pie"
    _module = "plotly.graph_objs._pie"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='pie', **kwargs)
