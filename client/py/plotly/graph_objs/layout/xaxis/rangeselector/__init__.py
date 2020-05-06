
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Button(WrappedObject):
    _name = "Button"
    _module = "plotly.graph_objs.layout.xaxis.rangeselector"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.xaxis.rangeselector"


__all__ = [
    'Button',
    'Font',
]