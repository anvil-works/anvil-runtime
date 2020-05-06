
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Button(WrappedObject):
    _name = "Button"
    _module = "plotly.graph_objs.layout.updatemenu"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.updatemenu"

@serializable_type
class Pad(WrappedObject):
    _name = "Pad"
    _module = "plotly.graph_objs.layout.updatemenu"


__all__ = [
    'Button',
    'Font',
    'Pad',
]