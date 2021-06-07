
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Activeshape(WrappedObject):
    _name = "Activeshape"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Annotation(WrappedObject):
    _name = "Annotation"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Coloraxis(WrappedObject):
    _name = "Coloraxis"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Colorscale(WrappedObject):
    _name = "Colorscale"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Geo(WrappedObject):
    _name = "Geo"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Grid(WrappedObject):
    _name = "Grid"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Hoverlabel(WrappedObject):
    _name = "Hoverlabel"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Image(WrappedObject):
    _name = "Image"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Legend(WrappedObject):
    _name = "Legend"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Mapbox(WrappedObject):
    _name = "Mapbox"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Margin(WrappedObject):
    _name = "Margin"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Modebar(WrappedObject):
    _name = "Modebar"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Newshape(WrappedObject):
    _name = "Newshape"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Polar(WrappedObject):
    _name = "Polar"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Scene(WrappedObject):
    _name = "Scene"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Shape(WrappedObject):
    _name = "Shape"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Slider(WrappedObject):
    _name = "Slider"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Ternary(WrappedObject):
    _name = "Ternary"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Title(WrappedObject):
    _name = "Title"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Transition(WrappedObject):
    _name = "Transition"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Uniformtext(WrappedObject):
    _name = "Uniformtext"
    _module = "plotly.graph_objs.layout"

@serializable_type
class Updatemenu(WrappedObject):
    _name = "Updatemenu"
    _module = "plotly.graph_objs.layout"

@serializable_type
class XAxis(WrappedObject):
    _name = "XAxis"
    _module = "plotly.graph_objs.layout"

@serializable_type
class YAxis(WrappedObject):
    _name = "YAxis"
    _module = "plotly.graph_objs.layout"


__all__ = [
    'Activeshape',
    'Annotation',
    'Coloraxis',
    'Colorscale',
    'Font',
    'Geo',
    'Grid',
    'Hoverlabel',
    'Image',
    'Legend',
    'Mapbox',
    'Margin',
    'Modebar',
    'Newshape',
    'Polar',
    'Scene',
    'Shape',
    'Slider',
    'Ternary',
    'Title',
    'Transition',
    'Uniformtext',
    'Updatemenu',
    'XAxis',
    'YAxis',
    'annotation',
    'coloraxis',
    'geo',
    'grid',
    'hoverlabel',
    'legend',
    'mapbox',
    'newshape',
    'polar',
    'scene',
    'shape',
    'slider',
    'ternary',
    'title',
    'updatemenu',
    'xaxis',
    'yaxis',
]

from plotly.graph_objs.layout import annotation
from plotly.graph_objs.layout import coloraxis
from plotly.graph_objs.layout import geo
from plotly.graph_objs.layout import grid
from plotly.graph_objs.layout import hoverlabel
from plotly.graph_objs.layout import legend
from plotly.graph_objs.layout import mapbox
from plotly.graph_objs.layout import newshape
from plotly.graph_objs.layout import polar
from plotly.graph_objs.layout import scene
from plotly.graph_objs.layout import shape
from plotly.graph_objs.layout import slider
from plotly.graph_objs.layout import ternary
from plotly.graph_objs.layout import title
from plotly.graph_objs.layout import updatemenu
from plotly.graph_objs.layout import xaxis
from plotly.graph_objs.layout import yaxis
