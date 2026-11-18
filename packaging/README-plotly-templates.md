# Check Plotly template compatibility

From the repository root, run the check with the Plotly version you want to test:

```bash
uv run --no-project --with plotly==7.1.0 python runtime/packaging/check-plotly-templates.py
```

The script loads the production template module as plain Python and asks Plotly
to validate all eight Anvil themes. It needs only Plotly: no platform, Downlink,
Uplink, database or pytest fixture. A rejected template raises Plotly's normal
validation error and exits unsuccessfully.

To reproduce a failure in another checkout, pass its template-module directory:

```bash
uv run --no-project --with plotly==7.1.0 python runtime/packaging/check-plotly-templates.py /path/to/master/runtime/downlink/python/anvil/plotly_templates
```

The shared JSON contains legacy `scattermapbox` and `layout.mapbox` defaults,
which Plotly 7 rejects. The loader converts these defaults for Plotly versions
that have removed Mapbox classes, while preserving them for older ones.

Frontend CI runs this script with 4.14.3 (legacy environment), 5.13.1 (full Python
environment), 5.24.1 (first modern-map series) and 7.1.0 (generator reference).
It does not exercise Anvil RPC or rendering. The generated Figure constructor's
omitted/None-layout behaviour is covered separately in the existing client tests.
