
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Project(WrappedObject):
    _name = "Project"
    _module = "plotly.graph_objs.surface.contours.x"


__all__ = [
    'Project',
]