
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Data(WrappedObject):
    _name = "Data"
    _module = "plotly.graph_objs.layout.template"


__all__ = [
    'Data',
]