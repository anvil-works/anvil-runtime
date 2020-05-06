
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Connector(WrappedObject):
    _name = "Connector"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Insidetextfont(WrappedObject):
    _name = "Insidetextfont"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Outsidetextfont(WrappedObject):
    _name = "Outsidetextfont"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.funnel"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.funnel"


__all__ = [
    'Connector',
    'Hoverlabel',
    'Insidetextfont',
    'Marker',
    'Outsidetextfont',
    'Stream',
    'Textfont',
    'connector',
    'hoverlabel',
    'marker',
]

from plotly.graph_objs.funnel import connector
from plotly.graph_objs.funnel import hoverlabel
from plotly.graph_objs.funnel import marker
