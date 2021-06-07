
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Insidetextfont(WrappedObject):
    _name = "Insidetextfont"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Outsidetextfont(WrappedObject):
    _name = "Outsidetextfont"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Pathbar(WrappedObject):
    _name = "Pathbar"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Root(WrappedObject):
    _name = "Root"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Tiling(WrappedObject):
    _name = "Tiling"
    _module = "plotly.graph_objs.treemap"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.treemap"


__all__ = [
    'Domain',
    'Hoverlabel',
    'Insidetextfont',
    'Marker',
    'Outsidetextfont',
    'Pathbar',
    'Root',
    'Stream',
    'Textfont',
    'Tiling',
    'Transform',
    'hoverlabel',
    'marker',
    'pathbar',
]

from plotly.graph_objs.treemap import hoverlabel
from plotly.graph_objs.treemap import marker
from plotly.graph_objs.treemap import pathbar
