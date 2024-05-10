const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const _urlCache = new Map();

module.exports = class BuildTimeSha extends CopyWebpackPlugin {
    constructor(patterns, hash = true) {
        super({ patterns });
        this._patterns = patterns;
        this._hash = hash;
    }
    apply(compiler) {
        super.apply(compiler);

        if (!this._hash) return;

        compiler.hooks.emit.tap("Output Hash", (compilation) => {
            const out = compilation.options.output.path;
            const { outputOptions, assets } = compilation;
            const { hashFunction, hashDigest, hashDigestLength, hashSalt } = outputOptions;

            // source code adapted from:
            // https://github.com/scinos/webpack-plugin-hash-output/blob/0b4adc20111fa0a798581703b51cd2e138b59b0e/src/OutputHash.js#L175-L180
            const hashFn = (input) => {
                const hashObj = crypto.createHash(hashFunction).update(input);
                if (hashSalt) hashObj.update(hashSalt);
                const fullHash = hashObj.digest(hashDigest);
                return { fullHash, shortHash: fullHash.substring(0, hashDigestLength) };
            };

            const getRelativeUrl = (url, relativePath) => {
                if (url.startsWith("{{app-origin}}/_/static/runtime")) {
                    return url.replace("{{app-origin}}/_/static/runtime", relativePath);
                }
                if (url.startsWith("{{cdn-origin}}/runtime")) {
                    return url.replace("{{cdn-origin}}/runtime", relativePath);
                }
                return url;
            };

            const getAssetHash = (url, { from, to, assets, out }) => {
                const urlCache = url.replace("{{app-origin}}/_/static/runtime", "").replace("{{cdn-origin}}/runtime", "");
                if (_urlCache.has(urlCache)) {
                    return _urlCache.get(urlCache);
                }
                const relativePaths = ["..", from.replace("/" + to, "")];
                for (const relativePath of relativePaths) {
                    let content;
                    const p = path.resolve(__dirname, getRelativeUrl(url, relativePath)).replace(/\\/g, "/");
                    // first check to see if we should expect to see the file in the dist folder
                    if (p.startsWith(out) || p.includes("/runtime/client/dist/")) {
                        const filename = p.split("/").at(-1);
                        const source = assets[filename];
                        if (source) {
                            content = source.source().toString();
                        } else {
                            // console.log("EXPECTED TO FIND", filename, "IN ACTIVE ASSETS BUT FAILED");
                        }
                    } else {
                        try {
                            content = fs.readFileSync(p, "utf8");
                        } catch (e) {
                            // pass - couldn't find this file
                        }
                    }
                    if (content) {
                        const { shortHash } = hashFn(content);
                        _urlCache.set(urlCache, shortHash);
                        return shortHash;
                    }
                }
            };

            // console.log("ACTIVE ASSETS");
            // console.log(Object.keys(assets));

            for (const { from, to } of this._patterns) {
                // console.log(to);
                if (!to.endsWith(".html")) continue;
                const asset = compilation.getAsset(to);
                const source = asset.source.source();
                let html = source.toString();
                for (const [_m, url] of html.matchAll(/"([^"]*?)\?buildTime=0"/g)) {
                    const hash = getAssetHash(url, { from, to, assets, out });
                    if (hash) {
                        html = html.replace(url + "?buildTime=0", url + "?sha=" + hash);
                    } else {
                        // console.log("FAILED TO FIND A SHA FOR", url);
                    }
                }
                compilation.updateAsset(to, new asset.source.constructor(Buffer.from(html, "utf-8")));
            }
        });
    }
};
