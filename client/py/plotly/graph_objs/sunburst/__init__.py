
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Insidetextfont(WrappedObject):
    _name = "Insidetextfont"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Leaf(WrappedObject):
    _name = "Leaf"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Outsidetextfont(WrappedObject):
    _name = "Outsidetextfont"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Root(WrappedObject):
    _name = "Root"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.sunburst"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.sunburst"


__all__ = [
    'Domain',
    'Hoverlabel',
    'Insidetextfont',
    'Leaf',
    'Marker',
    'Outsidetextfont',
    'Root',
    'Stream',
    'Textfont',
    'Transform',
    'hoverlabel',
    'marker',
]

from plotly.graph_objs.sunburst import hoverlabel
from plotly.graph_objs.sunburst import marker
