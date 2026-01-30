export function mapSetter(name, remapFn) {
    return function (s, e, v) {
        var m = {};
        m[name] = remapFn ? remapFn(v) : v;
        s._jsVal.setOptions(m);
    };
}

export function mapGetter(name, remapFn) {
    return function (s, e) {
        let getter = s._jsVal[name];
        if (getter) {
            let v = getter.call(s._jsVal);
            return remapFn ? remapFn(v) : v;
        }
    };
}
