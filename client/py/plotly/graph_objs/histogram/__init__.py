
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Cumulative(WrappedObject):
    _name = "Cumulative"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class ErrorX(WrappedObject):
    _name = "ErrorX"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class ErrorY(WrappedObject):
    _name = "ErrorY"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Selected(WrappedObject):
    _name = "Selected"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class Unselected(WrappedObject):
    _name = "Unselected"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class XBins(WrappedObject):
    _name = "XBins"
    _module = "plotly.graph_objs.histogram"

@serializable_type
class YBins(WrappedObject):
    _name = "YBins"
    _module = "plotly.graph_objs.histogram"


__all__ = [
    'Cumulative',
    'ErrorX',
    'ErrorY',
    'Hoverlabel',
    'Marker',
    'Selected',
    'Stream',
    'Transform',
    'Unselected',
    'XBins',
    'YBins',
    'hoverlabel',
    'marker',
    'selected',
    'unselected',
]

from plotly.graph_objs.histogram import hoverlabel
from plotly.graph_objs.histogram import marker
from plotly.graph_objs.histogram import selected
from plotly.graph_objs.histogram import unselected
