
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Cells(WrappedObject):
    _name = "Cells"
    _module = "plotly.graph_objs.table"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.table"

@serializable_type
class Header(WrappedObject):
    _name = "Header"
    _module = "plotly.graph_objs.table"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.table"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.table"


__all__ = [
    'Cells',
    'Domain',
    'Header',
    'Hoverlabel',
    'Stream',
    'cells',
    'header',
    'hoverlabel',
]

from plotly.graph_objs.table import cells
from plotly.graph_objs.table import header
from plotly.graph_objs.table import hoverlabel
