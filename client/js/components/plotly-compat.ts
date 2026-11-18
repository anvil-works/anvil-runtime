// Preserve common Plotly 3 inputs without changing Python objects or their RPC identities.
import type * as Plotly from "plotly.js";
import type { warn as runtimeWarn } from "../runner/warnings";

type Attributes = Record<string, any>;

const traceTypes: Record<string, string> = {
    scattermapbox: "scattermap",
    choroplethmapbox: "choroplethmap",
    densitymapbox: "densitymap",
};
const mapTypes = new Set(Object.values(traceTypes));
const buttonNames: Record<string, string> = {
    sendDataToCloud: "sendChartToCloud",
    resetViewMapbox: "resetViewMap",
    zoomInMapbox: "zoomInMap",
    zoomOutMapbox: "zoomOutMap",
};

/** Keep the component's ordinary Plotly calls, using shared warning keys to
 * suppress repeated compatibility warnings across the app run. */
export function wrapPlotly<T extends Pick<typeof Plotly, "react" | "restyle" | "relayout">>(
    rawPlotly: T,
    { warn }: { warn: typeof runtimeWarn }
) {
    function warnAboutInputs({
        data = [],
        layout = {},
        config = {},
    }: {
        data?: Attributes[];
        layout?: Attributes;
        config?: Attributes;
    }): void {
        for (const message of getPlotlyCompatibilityWarnings(data, layout, config)) {
            warn(message, {
                key: `plotly-compat:${message}`,
                docUrl: "/editor/common-errors#plotly-mapbox-warnings",
                docLinkTitle: "How to update your map",
            });
        }
    }

    return {
        ...rawPlotly,
        react(graphDiv: HTMLElement, data: Attributes[] = [], layout: Attributes = {}, config: Attributes = {}) {
            warnAboutInputs({ data, layout, config });
            const figure = preparePlotlyFigure(data, layout);
            return rawPlotly.react(graphDiv, figure.data, figure.layout, preparePlotlyConfig(config));
        },
        restyle(graphDiv: HTMLElement, update: Attributes, indices?: number | number[]) {
            warnAboutInputs({ data: [update] });
            return rawPlotly.restyle(graphDiv, preparePlotlyRestyle(update), indices);
        },
        relayout(graphDiv: HTMLElement, update: Attributes) {
            warnAboutInputs({ layout: update });
            return rawPlotly.relayout(graphDiv, preparePlotlyRelayout(update));
        },
    };
}

/** Messages contain no supplied tokens or resource URLs. Templates alone do not
 * trigger the legacy warning: older defaults include unused Mapbox entries. */
function getPlotlyCompatibilityWarnings(data: Attributes[], layout: Attributes, config: Attributes): string[] {
    const warnings: string[] = [];
    if (
        data.some(
            (item) =>
                [item.type].flat().some((type) => traceTypes[type]) ||
                [item.subplot].flat().some((name) => typeof name === "string" && /^mapbox\d*$/.test(name))
        ) ||
        Object.keys(layout).some((name) => /^mapbox\d*(\.|$)/.test(name))
    ) {
        warnings.push("This plot uses deprecated Mapbox names.");
    }
    const hasToken = (settings: Attributes) =>
        Object.entries(settings).some(
            ([name, value]) =>
                (/^map(?:box)?\d*$/.test(name) && value?.accesstoken != null) ||
                (/^map(?:box)?\d*\.accesstoken$/.test(name) && value != null)
        );
    if (config.mapboxAccessToken != null || hasToken(layout) || hasToken(layout.template?.layout ?? {})) {
        warnings.push("Plotly ignores Mapbox access tokens.");
    }
    return warnings;
}

function subplotName(value: any): any {
    return typeof value === "string" ? value.replace(/^mapbox(\d*)$/, "map$1") : value;
}

function mapLayout(value: Attributes): Attributes {
    const { accesstoken, ...map } = value;
    return map;
}

function trace(value: Attributes): Attributes {
    const result: Attributes = { ...value };
    if (value.type !== undefined) result.type = traceTypes[value.type] ?? value.type;
    if (value.subplot !== undefined) result.subplot = subplotName(value.subplot);
    return result;
}

function layout(value: Attributes, { templateDefaults = false } = {}): Attributes {
    const result: Attributes = {};
    for (const [key, entry] of Object.entries(value)) {
        const name = subplotName(key);
        if (name !== key && name in value) {
            // Plotly.py 6 templates commonly contain defaults for both renderers.
            if (templateDefaults) continue;
            throw new Error(
                `Both ${key} and ${name} are defined. Give legacy and modern maps separate subplot numbers.`
            );
        }
        result[name] = /^map\d*$/.test(name) && entry ? mapLayout(entry) : entry;
    }
    if (value.template && typeof value.template === "object") result.template = template(value.template);
    return result;
}

function template(value: Attributes): Attributes {
    const result = { ...value };
    if (value.layout) result.layout = layout(value.layout, { templateDefaults: true });
    if (value.data) {
        result.data = {};
        for (const [key, entries] of Object.entries(value.data)) {
            const name = traceTypes[key] ?? key;
            // Prefer modern defaults when older templates contain both families.
            if (name !== key && name in value.data) continue;
            result.data[name] = (entries as Attributes[]).map(trace);
        }
    }
    return result;
}

/** Convert a rendering copy, including legacy entries in resolved customer templates. */
function preparePlotlyFigure(data: Attributes[], inputLayout: Attributes): { data: Attributes[]; layout: Attributes } {
    // Legacy and modern renderers used separate subplot namespaces, even when
    // layout entries were implicit. Do not silently merge their traces.
    const legacySubplots = new Set(
        data.filter((item) => traceTypes[item.type]).map((item) => subplotName(item.subplot ?? "mapbox"))
    );
    for (const item of data) {
        if (mapTypes.has(item.type) && legacySubplots.has(item.subplot ?? "map")) {
            throw new Error("Legacy and modern map traces overlap. Give them separate subplot numbers.");
        }
    }
    const convertedData = data.map(trace);
    const convertedLayout = layout(inputLayout);
    const subplots = new Set(Object.keys(convertedLayout).filter((key) => /^(map|geo)\d*$/.test(key)));
    for (const item of convertedData) {
        if (mapTypes.has(item.type)) subplots.add(item.subplot ?? "map");
        if (item.type === "scattergeo" || item.type === "choropleth") subplots.add(item.geo ?? "geo");
    }
    for (const name of subplots) {
        const settings = convertedLayout[name] ?? {};
        // Base map/geo template defaults also apply to numbered subplots,
        // unless the template supplies defaults for that specific subplot.
        const templateSettings =
            convertedLayout.template?.layout?.[name] ?? convertedLayout.template?.layout?.[name.replace(/\d+$/, "")];
        // Plotly 4 auto-fits maps and geo plots. Keep the previous default, while
        // allowing an explicit value in either the figure or its template.
        if (settings.fitbounds === undefined && templateSettings?.fitbounds === undefined) {
            convertedLayout[name] = { ...settings, fitbounds: false };
        }
    }
    return { data: convertedData, layout: convertedLayout };
}

function preparePlotlyConfig(input: Attributes): Attributes {
    const { mapboxAccessToken, ...config } = input;
    // Plotly 4 enables cloud sharing and increases the double-click delay to
    // 500ms. Preserve Anvil's previous defaults while allowing app overrides.
    const result: Attributes = { showSendToCloud: false, doubleClickDelay: 300, ...config };
    const button = (value: any): any => {
        // Chart Studio editing was removed upstream; surviving buttons have replacements.
        if (Array.isArray(value)) return value.map(button).filter((entry) => entry !== "editInChartStudio");
        return typeof value === "string" ? (buttonNames[value] ?? value) : value;
    };
    for (const name of ["modeBarButtons", "modeBarButtonsToAdd", "modeBarButtonsToRemove"]) {
        if (Array.isArray(config[name])) result[name] = button(config[name]);
    }
    return result;
}

function preparePlotlyRestyle(input: Attributes): Attributes {
    const result = { ...input };
    for (const name of ["type", "subplot"]) {
        if (name in result) {
            const convert = name === "type" ? (value: any) => traceTypes[value] ?? value : subplotName;
            result[name] = Array.isArray(result[name]) ? result[name].map(convert) : convert(result[name]);
        }
    }
    return result;
}

function preparePlotlyRelayout(input: Attributes): Attributes {
    const result: Attributes = {};
    for (const [key, value] of Object.entries(input)) {
        const name = key.replace(/^mapbox(\d*)(?=\.|$)/, "map$1");
        if (/^map\d*\.accesstoken$/.test(name)) continue;
        if (name !== key && name in input) {
            throw new Error(`Both ${key} and ${name} are being updated. Use one map subplot name.`);
        }
        if (name === "template" && value && typeof value === "object") result[name] = template(value);
        else if (/^map\d*$/.test(name) && value) result[name] = mapLayout(value);
        else result[name] = value;
    }
    return result;
}
