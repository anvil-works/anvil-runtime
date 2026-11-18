"""Check Anvil templates with the installed Plotly; no running server is needed.

An optional directory argument selects the template module from another checkout.
"""
import runpy
from pathlib import Path
import sys

import plotly
import plotly.graph_objects as go


directory = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    Path(__file__).resolve().parents[1] / "downlink/python/anvil/plotly_templates"
)
templates = runpy.run_path(str(directory / "__init__.py"))["templates"]
print(f"Checking templates with Plotly {plotly.__version__}", flush=True)
# Other files in this directory are upstream templates, not Anvil themes.
for name in (
    "material_light", "material_dark", "rally_light", "rally_dark",
    "manarola_light", "manarola_dark", "mykonos_light", "mykonos_dark",
):
    # The loader applies the same version adaptation used in production.
    go.layout.Template(**templates[name])
    print(f"  OK {name}")
