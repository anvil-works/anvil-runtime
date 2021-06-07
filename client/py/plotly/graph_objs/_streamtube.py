
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Streamtube(WrappedObject):
    _name = "Streamtube"
    _module = "plotly.graph_objs._streamtube"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='streamtube', **kwargs)
