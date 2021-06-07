
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Table(WrappedObject):
    _name = "Table"
    _module = "plotly.graph_objs._table"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='table', **kwargs)
