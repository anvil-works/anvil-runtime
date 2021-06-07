
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Insidetextfont(WrappedObject):
    _name = "Insidetextfont"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Title(WrappedObject):
    _name = "Title"
    _module = "plotly.graph_objs.funnelarea"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.funnelarea"


__all__ = [
    'Domain',
    'Hoverlabel',
    'Insidetextfont',
    'Marker',
    'Stream',
    'Textfont',
    'Title',
    'Transform',
    'hoverlabel',
    'marker',
    'title',
]

from plotly.graph_objs.funnelarea import hoverlabel
from plotly.graph_objs.funnelarea import marker
from plotly.graph_objs.funnelarea import title
