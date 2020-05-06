
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.legend"

@serializable_type
class Title(WrappedObject):
    _name = "Title"
    _module = "plotly.graph_objs.layout.legend"


__all__ = [
    'Font',
    'Title',
    'title',
]

from plotly.graph_objs.layout.legend import title
