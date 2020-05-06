
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.sankey"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.sankey"

@serializable_type
class Link(WrappedObject):
    _name = "Link"
    _module = "plotly.graph_objs.sankey"

@serializable_type
class Node(WrappedObject):
    _name = "Node"
    _module = "plotly.graph_objs.sankey"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.sankey"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.sankey"


__all__ = [
    'Domain',
    'Hoverlabel',
    'Link',
    'Node',
    'Stream',
    'Textfont',
    'hoverlabel',
    'link',
    'node',
]

from plotly.graph_objs.sankey import hoverlabel
from plotly.graph_objs.sankey import link
from plotly.graph_objs.sankey import node
