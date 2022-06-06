var path = require("path");
var webpack = require("webpack");

module.exports = {
    context: path.resolve(__dirname),

    // We want to generate two bundles. One for runner. one for its Service Worker
    entry: {
        runner: ["./runner.js"],
        sw: ["./sw.js"],
    },

    // Make PyDefUtils available as window.PyDefUtils
    output: {
        path: path.resolve(__dirname),
        filename: "[name].bundle.js",
    },

    module: {
        rules: [
            {
                test: /\.tsx?/,
                use: [
                    {
                        loader: "babel-loader",
                        options: {
                            presets: [
                                ["@babel/preset-env"],
                            ],
                            plugins: [
                                "@babel/plugin-proposal-optional-chaining", 
                                "@babel/plugin-proposal-class-properties"
                            ],
                        },
                    },
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
                exclude : [
                  /core-js/,
                  /buildin/ // This bit of webpack has a circular dependency on core-js, which means... something. See https://github.com/zloirock/core-js/issues/743#issuecomment-572096103
                ],
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: [
                            [
                                "@babel/preset-env",
                                {
                                    useBuiltIns: "usage",
                                    corejs: "3.8",
                                    modules: "cjs",
                                },
                            ],
                            [
                                "@babel/preset-react",
                                {
                                    pragma: "PyDefUtils.h",
                                },
                            ],
                        ],
                        plugins: [
                            "@babel/plugin-proposal-optional-chaining", 
                            "@babel/plugin-proposal-class-properties"
                        ],
                    },
                },
            },
        ],
    },

    // Add an alias for resolving PyDefUtils and utils directly.
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            PyDefUtils: path.resolve(__dirname, "PyDefUtils.js"),
            utils: path.resolve(__dirname, "utils.js"),
        },
    },

    // Generate source maps
    devtool: "source-map",
};