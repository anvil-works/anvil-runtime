
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Decreasing(WrappedObject):
    _name = "Decreasing"
    _module = "plotly.graph_objs.indicator.delta"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.indicator.delta"

@serializable_type
class Increasing(WrappedObject):
    _name = "Increasing"
    _module = "plotly.graph_objs.indicator.delta"


__all__ = [
    'Decreasing',
    'Font',
    'Increasing',
]