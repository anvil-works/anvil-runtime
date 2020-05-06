
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Area(WrappedObject):
    _name = "Area"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='area', **kwargs)

@serializable_type
class Bar(WrappedObject):
    _name = "Bar"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='bar', **kwargs)

@serializable_type
class Barpolar(WrappedObject):
    _name = "Barpolar"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='barpolar', **kwargs)

@serializable_type
class Box(WrappedObject):
    _name = "Box"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='box', **kwargs)

@serializable_type
class Candlestick(WrappedObject):
    _name = "Candlestick"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='candlestick', **kwargs)

@serializable_type
class Carpet(WrappedObject):
    _name = "Carpet"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='carpet', **kwargs)

@serializable_type
class Choropleth(WrappedObject):
    _name = "Choropleth"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='choropleth', **kwargs)

@serializable_type
class Choroplethmapbox(WrappedObject):
    _name = "Choroplethmapbox"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='choroplethmapbox', **kwargs)

@serializable_type
class Cone(WrappedObject):
    _name = "Cone"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='cone', **kwargs)

@serializable_type
class Contour(WrappedObject):
    _name = "Contour"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='contour', **kwargs)

@serializable_type
class Contourcarpet(WrappedObject):
    _name = "Contourcarpet"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='contourcarpet', **kwargs)

@serializable_type
class Densitymapbox(WrappedObject):
    _name = "Densitymapbox"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='densitymapbox', **kwargs)

@serializable_type
class Frame(WrappedObject):
    _name = "Frame"
    _module = "plotly.graph_objs"

@serializable_type
class Funnel(WrappedObject):
    _name = "Funnel"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='funnel', **kwargs)

@serializable_type
class Funnelarea(WrappedObject):
    _name = "Funnelarea"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='funnelarea', **kwargs)

@serializable_type
class Heatmap(WrappedObject):
    _name = "Heatmap"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='heatmap', **kwargs)

@serializable_type
class Heatmapgl(WrappedObject):
    _name = "Heatmapgl"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='heatmapgl', **kwargs)

@serializable_type
class Histogram(WrappedObject):
    _name = "Histogram"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram', **kwargs)

@serializable_type
class Histogram2d(WrappedObject):
    _name = "Histogram2d"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram2d', **kwargs)

@serializable_type
class Histogram2dContour(WrappedObject):
    _name = "Histogram2dContour"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='histogram2dcontour', **kwargs)

@serializable_type
class Image(WrappedObject):
    _name = "Image"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='image', **kwargs)

@serializable_type
class Indicator(WrappedObject):
    _name = "Indicator"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='indicator', **kwargs)

@serializable_type
class Isosurface(WrappedObject):
    _name = "Isosurface"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='isosurface', **kwargs)

@serializable_type
class Layout(WrappedObject):
    _name = "Layout"
    _module = "plotly.graph_objs"

@serializable_type
class Mesh3d(WrappedObject):
    _name = "Mesh3d"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='mesh3d', **kwargs)

@serializable_type
class Ohlc(WrappedObject):
    _name = "Ohlc"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='ohlc', **kwargs)

@serializable_type
class Parcats(WrappedObject):
    _name = "Parcats"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='parcats', **kwargs)

@serializable_type
class Parcoords(WrappedObject):
    _name = "Parcoords"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='parcoords', **kwargs)

@serializable_type
class Pie(WrappedObject):
    _name = "Pie"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='pie', **kwargs)

@serializable_type
class Pointcloud(WrappedObject):
    _name = "Pointcloud"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='pointcloud', **kwargs)

@serializable_type
class Sankey(WrappedObject):
    _name = "Sankey"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='sankey', **kwargs)

@serializable_type
class Scatter(WrappedObject):
    _name = "Scatter"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatter', **kwargs)

@serializable_type
class Scatter3d(WrappedObject):
    _name = "Scatter3d"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatter3d', **kwargs)

@serializable_type
class Scattercarpet(WrappedObject):
    _name = "Scattercarpet"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattercarpet', **kwargs)

@serializable_type
class Scattergeo(WrappedObject):
    _name = "Scattergeo"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattergeo', **kwargs)

@serializable_type
class Scattergl(WrappedObject):
    _name = "Scattergl"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattergl', **kwargs)

@serializable_type
class Scattermapbox(WrappedObject):
    _name = "Scattermapbox"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scattermapbox', **kwargs)

@serializable_type
class Scatterpolar(WrappedObject):
    _name = "Scatterpolar"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterpolar', **kwargs)

@serializable_type
class Scatterpolargl(WrappedObject):
    _name = "Scatterpolargl"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterpolargl', **kwargs)

@serializable_type
class Scatterternary(WrappedObject):
    _name = "Scatterternary"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='scatterternary', **kwargs)

@serializable_type
class Splom(WrappedObject):
    _name = "Splom"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='splom', **kwargs)

@serializable_type
class Streamtube(WrappedObject):
    _name = "Streamtube"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='streamtube', **kwargs)

@serializable_type
class Sunburst(WrappedObject):
    _name = "Sunburst"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='sunburst', **kwargs)

@serializable_type
class Surface(WrappedObject):
    _name = "Surface"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='surface', **kwargs)

@serializable_type
class Table(WrappedObject):
    _name = "Table"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='table', **kwargs)

@serializable_type
class Treemap(WrappedObject):
    _name = "Treemap"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='treemap', **kwargs)

@serializable_type
class Violin(WrappedObject):
    _name = "Violin"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='violin', **kwargs)

@serializable_type
class Volume(WrappedObject):
    _name = "Volume"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='volume', **kwargs)

@serializable_type
class Waterfall(WrappedObject):
    _name = "Waterfall"
    _module = "plotly.graph_objs"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='waterfall', **kwargs)


from ._deprecations import AngularAxis
from ._deprecations import Annotation
from ._deprecations import Annotations
from ._deprecations import ColorBar
from ._deprecations import Contours
from ._deprecations import Data
from ._deprecations import ErrorX
from ._deprecations import ErrorY
from ._deprecations import ErrorZ
from ._deprecations import Font
from ._deprecations import Frames
from ._deprecations import Histogram2dcontour
from ._deprecations import Legend
from ._deprecations import Line
from ._deprecations import Margin
from ._deprecations import Marker
from ._deprecations import RadialAxis
from ._deprecations import Scene
from ._deprecations import Stream
from ._deprecations import Trace
from ._deprecations import XAxis
from ._deprecations import XBins
from ._deprecations import YAxis
from ._deprecations import YBins
from ._deprecations import ZAxis


__all__ = [
    'Area',
    'Bar',
    'Barpolar',
    'Box',
    'Candlestick',
    'Carpet',
    'Choropleth',
    'Choroplethmapbox',
    'Cone',
    'Contour',
    'Contourcarpet',
    'Densitymapbox',
    'Frame',
    'Funnel',
    'Funnelarea',
    'Heatmap',
    'Heatmapgl',
    'Histogram',
    'Histogram2d',
    'Histogram2dContour',
    'Image',
    'Indicator',
    'Isosurface',
    'Layout',
    'Mesh3d',
    'Ohlc',
    'Parcats',
    'Parcoords',
    'Pie',
    'Pointcloud',
    'Sankey',
    'Scatter',
    'Scatter3d',
    'Scattercarpet',
    'Scattergeo',
    'Scattergl',
    'Scattermapbox',
    'Scatterpolar',
    'Scatterpolargl',
    'Scatterternary',
    'Splom',
    'Streamtube',
    'Sunburst',
    'Surface',
    'Table',
    'Treemap',
    'Violin',
    'Volume',
    'Waterfall',
    '_figure',
    'area',
    'bar',
    'barpolar',
    'box',
    'candlestick',
    'carpet',
    'choropleth',
    'choroplethmapbox',
    'cone',
    'contour',
    'contourcarpet',
    'densitymapbox',
    'funnel',
    'funnelarea',
    'heatmap',
    'heatmapgl',
    'histogram',
    'histogram2d',
    'histogram2dcontour',
    'image',
    'indicator',
    'isosurface',
    'layout',
    'mesh3d',
    'ohlc',
    'parcats',
    'parcoords',
    'pie',
    'pointcloud',
    'sankey',
    'scatter',
    'scatter3d',
    'scattercarpet',
    'scattergeo',
    'scattergl',
    'scattermapbox',
    'scatterpolar',
    'scatterpolargl',
    'scatterternary',
    'splom',
    'streamtube',
    'sunburst',
    'surface',
    'table',
    'treemap',
    'violin',
    'volume',
    'waterfall',
]

from plotly.graph_objs import _figure
from plotly.graph_objs import area
from plotly.graph_objs import bar
from plotly.graph_objs import barpolar
from plotly.graph_objs import box
from plotly.graph_objs import candlestick
from plotly.graph_objs import carpet
from plotly.graph_objs import choropleth
from plotly.graph_objs import choroplethmapbox
from plotly.graph_objs import cone
from plotly.graph_objs import contour
from plotly.graph_objs import contourcarpet
from plotly.graph_objs import densitymapbox
from plotly.graph_objs import funnel
from plotly.graph_objs import funnelarea
from plotly.graph_objs import heatmap
from plotly.graph_objs import heatmapgl
from plotly.graph_objs import histogram
from plotly.graph_objs import histogram2d
from plotly.graph_objs import histogram2dcontour
from plotly.graph_objs import image
from plotly.graph_objs import indicator
from plotly.graph_objs import isosurface
from plotly.graph_objs import layout
from plotly.graph_objs import mesh3d
from plotly.graph_objs import ohlc
from plotly.graph_objs import parcats
from plotly.graph_objs import parcoords
from plotly.graph_objs import pie
from plotly.graph_objs import pointcloud
from plotly.graph_objs import sankey
from plotly.graph_objs import scatter
from plotly.graph_objs import scatter3d
from plotly.graph_objs import scattercarpet
from plotly.graph_objs import scattergeo
from plotly.graph_objs import scattergl
from plotly.graph_objs import scattermapbox
from plotly.graph_objs import scatterpolar
from plotly.graph_objs import scatterpolargl
from plotly.graph_objs import scatterternary
from plotly.graph_objs import splom
from plotly.graph_objs import streamtube
from plotly.graph_objs import sunburst
from plotly.graph_objs import surface
from plotly.graph_objs import table
from plotly.graph_objs import treemap
from plotly.graph_objs import violin
from plotly.graph_objs import volume
from plotly.graph_objs import waterfall
