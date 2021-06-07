
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Delta(WrappedObject):
    _name = "Delta"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Gauge(WrappedObject):
    _name = "Gauge"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Number(WrappedObject):
    _name = "Number"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Title(WrappedObject):
    _name = "Title"
    _module = "plotly.graph_objs.indicator"

@serializable_type
class Transform(WrappedObject):
    _name = "Transform"
    _module = "plotly.graph_objs.indicator"


__all__ = [
    'Delta',
    'Domain',
    'Gauge',
    'Number',
    'Stream',
    'Title',
    'Transform',
    'delta',
    'gauge',
    'number',
    'title',
]

from plotly.graph_objs.indicator import delta
from plotly.graph_objs.indicator import gauge
from plotly.graph_objs.indicator import number
from plotly.graph_objs.indicator import title
