// for babel-plugin-webpack-loaders
const config = require("./prod.config");

module.exports = {
  node: {
    fs: "empty"
  },
  output: {
    libraryTarget: "commonjs2"
  },
  module: {
    loaders: config.module.rules.slice(1) // remove babel-loader
  }
};
