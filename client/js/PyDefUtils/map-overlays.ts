type GoogleMapJsValue = google.maps.MVCObject & {
    setOptions(options: Record<string, unknown>): void;
    [name: string]: unknown;
};

interface GoogleMapOverlay {
    _jsVal: GoogleMapJsValue;
}

type RemapFn = (value: unknown) => unknown;

function getterNameToPropName(name: string) {
    return name.startsWith("get") && name.length > 3 ? name[3].toLowerCase() + name.slice(4) : name;
}

export function mapSetter(nameProp: string, remapFn?: RemapFn) {
    return function (s: unknown, e: unknown, v: unknown) {
        const overlay = s as GoogleMapOverlay;
        var m: Record<string, unknown> = {};
        m[nameProp] = remapFn ? remapFn(v) : v;
        overlay._jsVal.setOptions(m);
    };
}

export function mapGetter(nameProp: string, remapFn?: RemapFn) {
    return function (s: unknown, e: unknown): any {
        const overlay = s as GoogleMapOverlay;
        let getter = overlay._jsVal[nameProp];
        // Google overlay classes are inconsistent: Marker has getClickable/getZIndex, while shapes
        // expose some options only through the inherited MVCObject property bag.
        if (typeof getter === "function") {
            const v = getter.call(overlay._jsVal);
            return remapFn ? remapFn(v) : v;
        }
        const v = overlay._jsVal.get(getterNameToPropName(nameProp));
        return remapFn ? remapFn(v) : v;
    };
}
