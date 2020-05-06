
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Circle(WrappedObject):
    _name = "Circle"
    _module = "plotly.graph_objs.layout.mapbox.layer"

@serializable_type
class Fill(WrappedObject):
    _name = "Fill"
    _module = "plotly.graph_objs.layout.mapbox.layer"

@serializable_type
class Line(WrappedObject):
    _name = "Line"
    _module = "plotly.graph_objs.layout.mapbox.layer"

@serializable_type
class Symbol(WrappedObject):
    _name = "Symbol"
    _module = "plotly.graph_objs.layout.mapbox.layer"


__all__ = [
    'Circle',
    'Fill',
    'Line',
    'Symbol',
    'symbol',
]

from plotly.graph_objs.layout.mapbox.layer import symbol
