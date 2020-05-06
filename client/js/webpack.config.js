var path = require("path");
var webpack = require("webpack");

module.exports = {
  context: path.resolve(__dirname),

  // We want to generate two bundles. One for designer, one for runner.
  entry: {
    runner: ['babel-polyfill', './runner.js'],
  },

  // Make PyDefUtils available as window.PyDefUtils
  output: {
    path: path.resolve(__dirname),
    filename: '[name].bundle.js',
  },

  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      }
    ]
  },

  // Add an alias for resolving PyDefUtils and utils directly.
  resolve: {
    extensions: [ ".js" ],
    alias: {
      "PyDefUtils": path.resolve(__dirname, "PyDefUtils.js"),
      "utils": path.resolve(__dirname, "utils.js"),
    },
  },

  // Generate source maps
  devtool: "source-map",
};