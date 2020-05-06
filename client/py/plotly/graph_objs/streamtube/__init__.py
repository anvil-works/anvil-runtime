
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.streamtube"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.streamtube"

@serializable_type
class Lighting(WrappedObject):
    _name = "Lighting"
    _module = "plotly.graph_objs.streamtube"

@serializable_type
class Lightposition(WrappedObject):
    _name = "Lightposition"
    _module = "plotly.graph_objs.streamtube"

@serializable_type
class Starts(WrappedObject):
    _name = "Starts"
    _module = "plotly.graph_objs.streamtube"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.streamtube"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Lighting',
    'Lightposition',
    'Starts',
    'Stream',
    'colorbar',
    'hoverlabel',
]

from plotly.graph_objs.streamtube import colorbar
from plotly.graph_objs.streamtube import hoverlabel
