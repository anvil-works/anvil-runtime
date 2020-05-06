
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Fill(WrappedObject):
    _name = "Fill"
    _module = "plotly.graph_objs.table.header"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.table.header"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.table.header"


__all__ = [
    'Fill',
    'Font',
    'Line',
]