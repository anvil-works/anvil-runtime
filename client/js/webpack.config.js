var path = require("path");
var webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const OptimizeCssAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const TerserPlugin = require('terser-webpack-plugin');


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
        filename: "runner.min.css",
    }),
    new OptimizeCssAssetsPlugin(),
    new webpack.DefinePlugin({
        ANVIL_IN_DESIGNER: JSON.stringify(false),
    }),
];

const cssLoader = {
    test: /\.css$/,
    use: [MiniCssExtractPlugin.loader, "css-loader"],
};

module.exports = {
    context: path.resolve(__dirname),

    // We want to generate two bundles. One for runner. one for its Service Worker
    entry: {
        runner: ["./runner.js"],
        runner2: ["./runner/index.ts"],
        sw: ["./sw.js"],
        css: ["../css/runner.css"]
    },

    // Make PyDefUtils available as window.PyDefUtils
    output: {
        path: path.resolve(__dirname, "../dist"),
        filename: "[name].bundle.js",
    },

    module: {
        rules: [
            {
                test: /\.tsx?/,
                use: [babelLoader,
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
            cssLoader
        ],
    },

    plugins,
    optimization: {
        // minimize: false,
        minimizer: [new TerserPlugin({extractComments: false})],
    },
    // Add an alias for resolving PyDefUtils and utils directly.
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".css"],
        alias: {
            PyDefUtils: path.resolve(__dirname, "PyDefUtils.js"),
            "@Sk": path.resolve(__dirname, "@Sk"),
            "@runtime": path.resolve(__dirname),
            "@designer": path.resolve(__dirname, "../../../platform/runtime-client/js"),
        },
    },

    // Generate source maps
    devtool: "source-map",
};