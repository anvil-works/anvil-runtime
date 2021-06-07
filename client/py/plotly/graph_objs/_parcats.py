
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Parcats(WrappedObject):
    _name = "Parcats"
    _module = "plotly.graph_objs._parcats"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='parcats', **kwargs)
