
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Annotation(WrappedObject):
    _name = "Annotation"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class Aspectratio(WrappedObject):
    _name = "Aspectratio"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class Camera(WrappedObject):
    _name = "Camera"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class XAxis(WrappedObject):
    _name = "XAxis"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class YAxis(WrappedObject):
    _name = "YAxis"
    _module = "plotly.graph_objs.layout.scene"

@serializable_type
class ZAxis(WrappedObject):
    _name = "ZAxis"
    _module = "plotly.graph_objs.layout.scene"


__all__ = [
    'Annotation',
    'Aspectratio',
    'Camera',
    'Domain',
    'XAxis',
    'YAxis',
    'ZAxis',
    'annotation',
    'camera',
    'xaxis',
    'yaxis',
    'zaxis',
]

from plotly.graph_objs.layout.scene import annotation
from plotly.graph_objs.layout.scene import camera
from plotly.graph_objs.layout.scene import xaxis
from plotly.graph_objs.layout.scene import yaxis
from plotly.graph_objs.layout.scene import zaxis
