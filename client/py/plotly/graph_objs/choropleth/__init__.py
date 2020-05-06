
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class ColorBar(WrappedObject):
    _name = "ColorBar"
    _module = "plotly.graph_objs.choropleth"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.choropleth"

@serializable_type
class Marker(WrappedObject):
    _name = "Marker"
    _module = "plotly.graph_objs.choropleth"

@serializable_type
class Selected(WrappedObject):
    _name = "Selected"
    _module = "plotly.graph_objs.choropleth"

@serializable_type
class Stream(WrappedObject):
    _name = "Stream"
    _module = "plotly.graph_objs.choropleth"

@serializable_type
class Unselected(WrappedObject):
    _name = "Unselected"
    _module = "plotly.graph_objs.choropleth"


__all__ = [
    'ColorBar',
    'Hoverlabel',
    'Marker',
    'Selected',
    'Stream',
    'Unselected',
    'colorbar',
    'hoverlabel',
    'marker',
    'selected',
    'unselected',
]

from plotly.graph_objs.choropleth import colorbar
from plotly.graph_objs.choropleth import hoverlabel
from plotly.graph_objs.choropleth import marker
from plotly.graph_objs.choropleth import selected
from plotly.graph_objs.choropleth import unselected
