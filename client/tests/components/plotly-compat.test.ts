import { afterEach, beforeEach, describe, expect, it, rstest } from "@rstest/core";
import { wrapPlotly } from "../../js/components/plotly-compat";
import { warn as runtimeWarn } from "../../js/runner/warnings";

const raw = { react: rstest.fn(), restyle: rstest.fn(), relayout: rstest.fn() };
const warn = rstest.fn();
let wrappedPlotly: ReturnType<typeof wrapPlotly<typeof raw>>;
let graphDiv: HTMLElement;

beforeEach(() => {
    rstest.clearAllMocks();
    graphDiv = {} as HTMLElement;
    wrappedPlotly = wrapPlotly(raw, { warn });
});

afterEach(() => rstest.unstubAllGlobals());

describe("Plotly 3 compatibility through the wrapped library", () => {
    it("warns once per app run across replacement plots and updates, without exposing credentials", () => {
        const print = rstest.fn();
        rstest.stubGlobal("Sk", { builtin: { print } });
        wrappedPlotly = wrapPlotly(raw, { warn: runtimeWarn });
        const data = [{ type: "scattermapbox" }];
        const layout = { mapbox: { accesstoken: "secret" } };
        wrappedPlotly.react(graphDiv, data, layout);
        wrappedPlotly.react(graphDiv, data, layout);
        wrappedPlotly.restyle(graphDiv, { type: ["scatter", "densitymapbox"] });
        wrappedPlotly.relayout(graphDiv, { "mapbox2.zoom": 4 });
        wrappedPlotly.react({} as HTMLElement, data, {}, { mapboxAccessToken: "secret" });
        wrapPlotly(raw, { warn: runtimeWarn }).react({} as HTMLElement, data, layout);
        const messages = print.mock.calls.map(([[message]]) => message);
        expect(messages).toHaveLength(2);
        expect(messages[0]).toContain("deprecated Mapbox names");
        expect(messages[1]).toContain("ignores Mapbox access tokens");
        expect(messages.join(" ")).not.toContain("secret");
    });

    it("renders all three legacy map types and numbered subplots without rewriting RPC data", () => {
        const data = [
            { type: "scattermapbox", lat: [50], lon: [-1] },
            { type: "choroplethmapbox", subplot: "mapbox2", locations: ["area"] },
            { type: "densitymapbox", subplot: "mapbox2", z: [4] },
        ];
        const layout = { mapbox: { style: "light", accesstoken: "old-token" }, mapbox2: { zoom: 3 } };
        const result = Promise.resolve(graphDiv);
        raw.react.mockReturnValueOnce(result);
        expect(wrappedPlotly.react(graphDiv, data, layout)).toBe(result);
        const [target, convertedData, convertedLayout] = raw.react.mock.calls[0];
        expect(target).toBe(graphDiv);
        expect(convertedData.map((item: any) => item.type)).toEqual(["scattermap", "choroplethmap", "densitymap"]);
        expect(convertedData[1].subplot).toBe("map2");
        expect(convertedLayout).toEqual({
            map: { style: "light", fitbounds: false },
            map2: { zoom: 3, fitbounds: false },
        });
        expect(data[0].type).toBe("scattermapbox");
        expect(layout.mapbox.accesstoken).toBe("old-token");
        expect(convertedData[0].lat).toBe(data[0].lat);
    });

    it("converts customer templates on both rendering and relayout, respecting fitting defaults", () => {
        const template = {
            layout: { mapbox: { style: "dark", fitbounds: "locations" } },
            data: { scattermapbox: [{ type: "scattermapbox", marker: { size: 12 } }] },
        };
        wrappedPlotly.react(graphDiv, [{ type: "scattermapbox" }], { template });
        const layout = raw.react.mock.calls[0][2];
        expect(layout.template.layout).toEqual({ map: { style: "dark", fitbounds: "locations" } });
        expect(layout.template.data.scattermap[0]).toEqual({ type: "scattermap", marker: { size: 12 } });
        expect(layout.map).toBeUndefined();
        wrappedPlotly.relayout(graphDiv, { template });
        expect(raw.relayout.mock.calls[0][1].template).toEqual(layout.template);
        expect(template.layout.mapbox.style).toBe("dark");
        expect(template.data.scattermapbox[0].type).toBe("scattermapbox");
    });

    it("keeps the old initial map/geo view, including implicit and numbered subplots", () => {
        wrappedPlotly.react(
            graphDiv,
            [{ type: "scattermap", subplot: "map2" }, { type: "scattergeo", geo: "geo2" }, { type: "choropleth" }],
            { geo: { fitbounds: "locations" }, template: { layout: { map: { fitbounds: false } } } }
        );
        const layout = raw.react.mock.calls[0][2];
        expect(layout.geo.fitbounds).toBe("locations");
        expect(layout.geo2.fitbounds).toBe(false);
        expect(layout.map2).toBeUndefined();
        wrappedPlotly.react(graphDiv, [{ type: "scattermap" }]);
        expect(raw.react.mock.calls[1][2].map.fitbounds).toBe(false);
    });

    it("rejects overlapping figures while preferring modern defaults in mixed templates", () => {
        expect(() => wrappedPlotly.react(graphDiv, [], { mapbox2: {}, map2: {} })).toThrow("Both mapbox2 and map2");
        for (const data of [
            [{ type: "scattermapbox" }, { type: "scattermap" }],
            [
                { type: "scattermapbox", subplot: "mapbox2" },
                { type: "scattermap", subplot: "map2" },
            ],
        ]) {
            expect(() => wrappedPlotly.react(graphDiv, data)).toThrow("Legacy and modern map traces overlap");
        }
        expect(raw.react).not.toHaveBeenCalled();
        wrappedPlotly.react(graphDiv, [{ type: "scattermapbox" }, { type: "scattermap", subplot: "map2" }], {
            template: {
                data: { scattermapbox: [{ marker: { size: 1 } }], scattermap: [{ marker: { size: 2 } }] },
                layout: { mapbox: { style: "dark" }, map: { style: "light" } },
            },
        });
        const [, data, layout] = raw.react.mock.calls[0];
        expect(data.map((item: any) => item.subplot ?? "map")).toEqual(["map", "map2"]);
        expect(layout.template.data.scattermap).toEqual([{ marker: { size: 2 } }]);
        expect(layout.template.layout.map).toEqual({ style: "light" });
    });

    it("leaves resource handling to Plotly and warns without exposing URLs or changing GeoJSON", () => {
        const template = { layout: { mapbox: { style: "mapbox://styles/private/unused" } } };
        wrappedPlotly.react(graphDiv, [{ type: "scatter", x: [1], y: [2] }], { template });
        expect(warn).not.toHaveBeenCalled();
        expect(raw.react.mock.lastCall![2].template.layout.map.style).toBe(template.layout.mapbox.style);
        wrappedPlotly.relayout(graphDiv, { template });
        expect(raw.relayout.mock.lastCall![1].template.layout.map.style).toBe(template.layout.mapbox.style);

        for (const style of [
            "mapbox://styles/private/style?secret=token",
            "stamen-terrain",
            { sources: { tiles: { url: "mapbox://tiles" } } },
        ]) {
            wrappedPlotly.react(graphDiv, [{ type: "scattermapbox" }], { mapbox: { style } });
            expect(raw.react.mock.lastCall![2].map.style).toBe(style);
        }
        expect(warn.mock.calls[0][0]).toContain("deprecated Mapbox names");
        expect(warn.mock.calls.join(" ")).not.toContain("mapbox://");
        expect(warn.mock.calls.join(" ")).not.toContain("secret=token");

        const style = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
        const source = { type: "FeatureCollection", features: [{ properties: { name: "mapbox://data-label" } }] };
        wrappedPlotly.react(graphDiv, [], { mapbox: { style, layers: [{ source }] } });
        expect(raw.react.mock.lastCall![2].map.style).toBe(style);
        expect(raw.react.mock.lastCall![2].map.layers[0].source).toBe(source);
        const layers = [{ source: "mapbox://tiles" }];
        wrappedPlotly.relayout(graphDiv, {
            "mapbox.style": "mapbox://styles/private",
            "mapbox.layers": layers,
            "mapbox.layers[0].source": "mapbox://tiles",
        });
        expect(raw.relayout).toHaveBeenCalledWith(graphDiv, {
            "map.style": "mapbox://styles/private",
            "map.layers": layers,
            "map.layers[0].source": "mapbox://tiles",
        });
    });

    it("preserves config defaults and remaps button names without changing custom buttons", () => {
        const custom = { name: "custom", click: () => {} };
        const config = {
            modeBarButtons: [["resetViewMapbox", custom, "editInChartStudio"]],
            modeBarButtonsToAdd: ["zoomInMapbox", "sendDataToCloud"],
            modeBarButtonsToRemove: ["zoomOutMapbox"],
            mapboxAccessToken: "old-token",
        };
        wrappedPlotly.react(graphDiv, [], {}, config);
        const converted = raw.react.mock.calls[0][3];
        expect(converted.showSendToCloud).toBe(false);
        expect(converted.doubleClickDelay).toBe(300);
        expect(converted.mapboxAccessToken).toBeUndefined();
        expect(converted.modeBarButtons).toEqual([["resetViewMap", custom]]);
        expect(converted.modeBarButtons[0][1]).toBe(custom);
        expect(converted.modeBarButtonsToAdd).toEqual(["zoomInMap", "sendChartToCloud"]);
        expect(converted.modeBarButtonsToRemove).toEqual(["zoomOutMap"]);
        expect(config.modeBarButtonsToRemove).toEqual(["zoomOutMapbox"]);
        wrappedPlotly.react(graphDiv, [], {}, { showSendToCloud: true, doubleClickDelay: 500 });
        expect(raw.react.mock.calls[1][3]).toMatchObject({ showSendToCloud: true, doubleClickDelay: 500 });
    });

    it("translates incremental updates and passes their targets, indices and results through", () => {
        const result = Promise.resolve(graphDiv);
        raw.restyle.mockReturnValueOnce(result);
        expect(
            wrappedPlotly.restyle(
                graphDiv,
                { type: ["scattermapbox", "scatter"], subplot: ["mapbox2", "mapbox"], lat: [[51]] },
                [0, 1]
            )
        ).toBe(result);
        expect(raw.restyle).toHaveBeenCalledWith(
            graphDiv,
            { type: ["scattermap", "scatter"], subplot: ["map2", "map"], lat: [[51]] },
            [0, 1]
        );
        raw.relayout.mockReturnValueOnce(result);
        expect(
            wrappedPlotly.relayout(graphDiv, {
                "mapbox2.center.lat": 51,
                "mapbox2.accesstoken": "token",
                mapbox: { style: "light", accesstoken: "token" },
            })
        ).toBe(result);
        expect(raw.relayout).toHaveBeenCalledWith(graphDiv, { "map2.center.lat": 51, map: { style: "light" } });
        expect(() => wrappedPlotly.relayout(graphDiv, { "mapbox.zoom": 1, "map.zoom": 2 })).toThrow(
            "Both mapbox.zoom and map.zoom"
        );
    });
});
