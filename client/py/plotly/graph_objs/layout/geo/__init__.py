
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Center(WrappedObject):
    _name = "Center"
    _module = "plotly.graph_objs.layout.geo"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.layout.geo"

@serializable_type
class Lataxis(WrappedObject):
    _name = "Lataxis"
    _module = "plotly.graph_objs.layout.geo"

@serializable_type
class Lonaxis(WrappedObject):
    _name = "Lonaxis"
    _module = "plotly.graph_objs.layout.geo"

@serializable_type
class Projection(WrappedObject):
    _name = "Projection"
    _module = "plotly.graph_objs.layout.geo"


__all__ = [
    'Center',
    'Domain',
    'Lataxis',
    'Lonaxis',
    'Projection',
    'projection',
]

from plotly.graph_objs.layout.geo import projection
