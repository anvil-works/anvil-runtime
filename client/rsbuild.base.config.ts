import { xxh64 } from "@node-rs/xxhash";
import { defineConfig, RsbuildConfig, RsbuildPlugin, Rspack } from "@rsbuild/core";
import { pluginCssMinimizer } from "@rsbuild/plugin-css-minimizer";
import { pluginSass } from "@rsbuild/plugin-sass";
import chalk from "chalk";
import fs from "fs";
import path from "path";

const _urlCache = new Map();

const hashFn = (input: string) => {
    // Use xxhash64 to match RSBuild's default hashFunction: 'xxhash64'
    // Convert to hex with toString(16) to match RSBuild's default hashDigest: 'hex'
    const fullHash = xxh64(input).toString(16);
    // Take first 12 characters to match RSBuild's filename patterns like [contenthash:12]
    return { fullHash, shortHash: fullHash.substring(0, 12) };
};

const getRelativeUrl = (url: string) => {
    if (url.startsWith("{{app-origin}}/_/static/runtime")) {
        return url.replace("{{app-origin}}/_/static/runtime", "..");
    }
    if (url.startsWith("{{cdn-origin}}/runtime")) {
        return url.replace("{{cdn-origin}}/runtime", "..");
    }
    throw new Error("Unhandled URL: " + url);
};

const getAssetHash = (url: string, distPath: string, compilation: Rspack.Compilation) => {
    const searchPaths = [...new Set([path.join(__dirname, "dist"), distPath])];
    const cachedUrl = url.replace("{{app-origin}}/_/static/runtime", "").replace("{{cdn-origin}}/runtime", "");
    const cached = _urlCache.get(cachedUrl);
    if (cached) return cached;

    if (cachedUrl.startsWith("/dist/")) {
        const assetUrl = cachedUrl.slice("/dist/".length);

        const assetEntry = Object.entries(compilation.assets).find(([key]) => key.split("?sha=")[0] === assetUrl);
        if (!assetEntry) {
            throw new Error(chalk.red("Could not find asset: ") + cachedUrl);
        }
        const sha = assetEntry[0].split("?sha=")[1];
        if (!sha) {
            throw new Error("INVALID: " + cachedUrl);
        }
        _urlCache.set(cachedUrl, sha);
        return sha;
    }

    for (const root of searchPaths) {
        try {
            const p = path.resolve(root, getRelativeUrl(url));
            const assetContent = fs.readFileSync(p, "utf8");
            const { shortHash } = hashFn(assetContent);
            _urlCache.set(cachedUrl, shortHash);
            return shortHash;
        } catch (e) {
            // pass
        }
    }
    throw new Error(chalk.red("Could not find asset: ") + url);
};

// Integrated BuildTimeSha plugin for Rsbuild
export function buildTimeShaPlugin(): RsbuildPlugin {
    return {
        name: "build-time-sha",
        setup(api) {
            api.modifyHTML((html, { environment, compilation }) => {
                if (environment.config.mode !== "production") return html;

                let modifiedHtml = html;
                const urlMatches = [...modifiedHtml.matchAll(/"([^"]*?)\?buildTime=0"/g)];
                let processedSha = 0;
                let totalProcessableUrls = 0;

                for (const [_m, url] of urlMatches) {
                    if (url.includes("{{manifest-url}}")) {
                        continue;
                    }

                    totalProcessableUrls++;

                    try {
                        const shortHash = getAssetHash(url, environment.distPath, compilation);
                        modifiedHtml = modifiedHtml.replace(url + "?buildTime=0", url + "?sha=" + shortHash);
                        processedSha++;
                    } catch (e) {
                        console.warn(chalk.red("Could not find asset for ") + url);
                    }
                }

                if (totalProcessableUrls > 0) {
                    console.log(
                        chalk.blueBright("BuildTimeShaPlugin\t"),
                        `processed ${processedSha}/${totalProcessableUrls} SHAs (${environment.name})`
                    );
                }

                return modifiedHtml;
            });
        },
    };
}

// Plugin to copy node_modules files to js/lib and css/lib directories (with change detection)
export function copyNodeModulesToLibPlugin(): RsbuildPlugin {
    return {
        name: "copy-node-modules-to-lib",
        setup(api) {
            api.onBeforeBuild(() => {
                const sourceFiles = [
                    { src: "node_modules/jquery/dist/jquery.min.js", dest: "js/lib/jquery.min.js" },
                    {
                        src: "node_modules/jquery-migrate/dist/jquery-migrate.min.js",
                        dest: "js/lib/jquery-migrate.min.js",
                    },
                    { src: "node_modules/bootstrap/dist/js/bootstrap.min.js", dest: "js/lib/bootstrap.min.js" },
                    { src: "node_modules/moment/min/moment.min.js", dest: "js/lib/moment.min.js" },
                    {
                        src: "node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.min.js",
                        dest: "js/lib/moment-timezone-with-data-10-year-range.min.js",
                    },
                ];

                // Ensure js/lib and css/lib directories exist
                const jsLibDir = path.resolve(__dirname, "js/lib");
                const cssLibDir = path.resolve(__dirname, "css/lib");
                if (!fs.existsSync(jsLibDir)) {
                    fs.mkdirSync(jsLibDir, { recursive: true });
                }
                if (!fs.existsSync(cssLibDir)) {
                    fs.mkdirSync(cssLibDir, { recursive: true });
                }

                let copiedCount = 0;
                let skippedCount = 0;

                // Copy each file only if changed
                sourceFiles.forEach(({ src, dest }) => {
                    const srcPath = path.resolve(__dirname, src);
                    const destPath = path.resolve(__dirname, dest);

                    try {
                        if (!fs.existsSync(srcPath)) {
                            console.warn(chalk.yellow(`Source file not found: ${src}`));
                            return;
                        }

                        // Check if destination exists and compare modification times
                        if (fs.existsSync(destPath)) {
                            const srcStats = fs.statSync(srcPath);
                            const destStats = fs.statSync(destPath);

                            // If destination is newer or same age, skip
                            if (destStats.mtime >= srcStats.mtime) {
                                skippedCount++;
                                return;
                            }
                        }

                        // Copy file (destination doesn't exist or source is newer)
                        fs.copyFileSync(srcPath, destPath);
                        console.log(chalk.green(`Copied ${src} → ${dest}`));
                        copiedCount++;
                    } catch (error) {
                        console.error(chalk.red(`Failed to copy ${src} → ${dest}:`), error);
                    }
                });

                // Summary
                if (copiedCount > 0 || skippedCount > 0) {
                    console.log(
                        chalk.blue(`Node modules sync: ${copiedCount} copied, ${skippedCount} skipped (up-to-date)`)
                    );
                }
            });
        },
    };
}

// Raw config object for merging
export const baseConfigObject: RsbuildConfig = {
    output: {
        assetPrefix: "auto",
        target: "web",
        cleanDistPath: true,
        filename: {
            js: "[name].bundle.js?sha=[contenthash:12]",
            css: "[name].css?sha=[contenthash:12]",
            assets: "[name][ext]?sha=[contenthash:12]",
            svg: "[name].svg?sha=[contenthash:12]",
            image: "[name][ext]?sha=[contenthash:12]",
            font: "[name][ext]?sha=[contenthash:12]",
            media: "[name][ext]?sha=[contenthash:12]",
            wasm: "[name].wasm?sha=[contenthash:12]",
        },
        sourceMap: {
            js: "source-map",
            css: true,
        },
        polyfill: "usage",
        /*
         * To change the browserlist see: https://rsbuild.rs/guide/advanced/browserslist#set-browserslist
         */
        overrideBrowserslist: ["since 2019 and fully supports es6-module and not dead"],
    },
    server: {
        base: "/",
        port: 5173,
    },
    dev: {
        writeToDisk: true,
        assetPrefix: "auto",
        hmr: false, // we probably don't need this, live reload is enough
        client: {
            port: "5172",
        },
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".css"],
        alias: {
            PyDefUtils: path.resolve(__dirname, "js/PyDefUtils"),
            "@Sk": path.resolve(__dirname, "js/@Sk"),
            "@runtime": path.resolve(__dirname, "js"),
            "@runtime-assets": path.resolve(__dirname),
            "@designer": path.resolve(__dirname, "../../platform/runtime-client/js/designer"),
            "@platform-runner": path.resolve(__dirname, "../../platform/runtime-client/js/runner"),
        },
    },

    // output config is environment-specific

    tools: {
        swc: {
            jsc: {
                parser: {
                    syntax: "typescript",
                    tsx: true,
                },
                transform: {
                    react: {
                        pragma: "PyDefUtils.h",
                        pragmaFrag: "PyDefUtils.Fragment",
                    },
                },
            },
        },
        // because lightningcss eats precision, we need to use cssnano
        // https://github.com/parcel-bundler/lightningcss/issues/949
        lightningcssLoader: false,
    },

    plugins: [
        pluginSass({
            sassLoaderOptions: {
                sourceMap: true,
            },
        }),
        buildTimeShaPlugin(),
        copyNodeModulesToLibPlugin(),
        // use instead of lightningcssLoader
        pluginCssMinimizer(),
    ],

    performance: {
        chunkSplit: {
            // strategy: "split-by-experience",
            strategy: "all-in-one",
        },
    },
};

// defineConfig version for standalone use
export const baseConfig = defineConfig(() => {
    return baseConfigObject;
});
