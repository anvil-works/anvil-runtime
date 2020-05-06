
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Aaxis(WrappedObject):
    _name = "Aaxis"
    _module = "plotly.graph_objs.layout.ternary"

@serializable_type
class Baxis(WrappedObject):
    _name = "Baxis"
    _module = "plotly.graph_objs.layout.ternary"

@serializable_type
class Caxis(WrappedObject):
    _name = "Caxis"
    _module = "plotly.graph_objs.layout.ternary"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.layout.ternary"


__all__ = [
    'Aaxis',
    'Baxis',
    'Caxis',
    'Domain',
    'aaxis',
    'baxis',
    'caxis',
]

from plotly.graph_objs.layout.ternary import aaxis
from plotly.graph_objs.layout.ternary import baxis
from plotly.graph_objs.layout.ternary import caxis
