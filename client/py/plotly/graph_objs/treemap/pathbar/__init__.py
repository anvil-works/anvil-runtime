
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.treemap.pathbar"


__all__ = [
    'Textfont',
]