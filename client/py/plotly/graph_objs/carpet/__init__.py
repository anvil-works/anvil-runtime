
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Aaxis(WrappedObject):
    _name = "Aaxis"
    _module = "plotly.graph_objs.carpet"

@serializable_type
class Baxis(WrappedObject):
    _name = "Baxis"
    _module = "plotly.graph_objs.carpet"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.carpet"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.carpet"


__all__ = [
    'Aaxis',
    'Baxis',
    'Font',
    'Stream',
    'aaxis',
    'baxis',
]

from plotly.graph_objs.carpet import aaxis
from plotly.graph_objs.carpet import baxis
