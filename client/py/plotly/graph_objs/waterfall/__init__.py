
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Connector(WrappedObject):
    _name = "Connector"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Decreasing(WrappedObject):
    _name = "Decreasing"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Increasing(WrappedObject):
    _name = "Increasing"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Insidetextfont(WrappedObject):
    _name = "Insidetextfont"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Outsidetextfont(WrappedObject):
    _name = "Outsidetextfont"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Textfont(WrappedObject):
    _name = "Textfont"
    _module = "plotly.graph_objs.waterfall"

@serializable_type
class Totals(WrappedObject):
    _name = "Totals"
    _module = "plotly.graph_objs.waterfall"


__all__ = [
    'Connector',
    'Decreasing',
    'Hoverlabel',
    'Increasing',
    'Insidetextfont',
    'Outsidetextfont',
    'Stream',
    'Textfont',
    'Totals',
    'connector',
    'decreasing',
    'hoverlabel',
    'increasing',
    'totals',
]

from plotly.graph_objs.waterfall import connector
from plotly.graph_objs.waterfall import decreasing
from plotly.graph_objs.waterfall import hoverlabel
from plotly.graph_objs.waterfall import increasing
from plotly.graph_objs.waterfall import totals
