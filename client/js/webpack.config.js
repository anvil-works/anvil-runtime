var path = require("path");
var webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const OptimizeCssAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const BuildTimeSha = require("./buildtime-sha");

const babelLoader = {
    loader: "babel-loader",
    options: {
        presets: [
            [
                "@babel/preset-env",
                {
                    useBuiltIns: "usage",
                    corejs: "3.8",
                    modules: "cjs",
                    targets: { esmodules: true },
                },
            ],
            [
                "@babel/preset-react",
                {
                    pragma: "PyDefUtils.h",
                },
            ],
        ],
        plugins: ["@babel/plugin-proposal-optional-chaining", "@babel/plugin-proposal-class-properties"],
    },
};

const plugins = [
    new MiniCssExtractPlugin({
        filename: "[name]",
    }),
    new OptimizeCssAssetsPlugin(),
    new webpack.DefinePlugin({
        ANVIL_IN_DESIGNER: JSON.stringify(false),
        BUILD_TIME: JSON.stringify(Date.now()),
    }),
];

const cssLoader = {
    test: /\.(sa|sc|c)ss$/,
    use: [
        MiniCssExtractPlugin.loader,
        {
            loader: "css-loader",
            options: {
                url: false, // Disable URL handling in CSS
            },
        },
        "sass-loader"
    ],
};

module.exports = (env, argv) => {
    const mode = argv.mode || "development";
    plugins.push(
        new BuildTimeSha(
            [
                { from: "../runner.html", to: "runner.html" },
                { from: "../runner2.html", to: "runner2.html" },
            ],
            mode === "production"
        )
    );

    return {
        context: path.resolve(__dirname),

        // We want to generate two bundles. One for runner. one for its Service Worker
        entry: {
            runner: ["./runner.js"],
            runner2: ["./runner/index.ts"],
            sw: ["./sw.js"],
            "runner.min.css": ["../css/runner.scss"],
            "runner-v3.min.css": ["../css/runner-v3.scss"],
        },

        // Make PyDefUtils available as window.PyDefUtils
        output: {
            hashFunction: "sha256",
            path: path.resolve(__dirname, "../dist"),
            filename: "[name].bundle.js",
            chunkFilename: "[name].bundle.js?sha=[chunkhash]",
            publicPath: "_/static/runtime/dist/",
        },

        module: {
            rules: [
                {
                    test: /\.tsx?/,
                    use: [
                        babelLoader,
                        {
                            loader: "ts-loader",
                            options: {
                                transpileOnly: true,
                            },
                        },
                    ],
                    exclude: /node_modules/,
                },
                {
                    test: /\.js$/,
                    include: [path.resolve(__dirname, "js"), /client/],
                    exclude: [
                        /core-js/,
                        /buildin/, // This bit of webpack has a circular dependency on core-js, which means... something. See https://github.com/zloirock/core-js/issues/743#issuecomment-572096103
                    ],
                    use: babelLoader,
                },
                cssLoader,
            ],
        },

        plugins,
        optimization: {
            // minimize: false,
            minimizer: [new TerserPlugin({ extractComments: false })],
        },
        // Add an alias for resolving PyDefUtils and utils directly.
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".css"],
            alias: {
                PyDefUtils: path.resolve(__dirname, "PyDefUtils.js"),
                "@Sk": path.resolve(__dirname, "@Sk"),
                "@runtime": path.resolve(__dirname),
                "@designer": path.resolve(__dirname, "../../../platform/runtime-client/js/designer"),
                "@platform-runner": path.resolve(__dirname, "../../../platform/runtime-client/js/runner"),
            },
        },

        // Generate source maps
        devtool: "source-map",
    };
};
