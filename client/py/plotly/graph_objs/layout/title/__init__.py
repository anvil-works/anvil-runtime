
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.title"

@serializable_type
class Pad(WrappedObject):
    _name = "Pad"
    _module = "plotly.graph_objs.layout.title"


__all__ = [
    'Font',
    'Pad',
]