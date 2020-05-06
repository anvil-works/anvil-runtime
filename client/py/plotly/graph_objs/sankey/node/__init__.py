
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.sankey.node"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.sankey.node"


__all__ = [
    'Hoverlabel',
    'Line',
    'hoverlabel',
]

from plotly.graph_objs.sankey.node import hoverlabel
