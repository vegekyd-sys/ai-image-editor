// Patch require() to handle .md files as raw text strings
// Used when running outside Next.js (which has webpack raw-loader)
const fs = require('fs');
const Module = require('module');

const origResolveFilename = Module._resolveFilename;
const origLoad = Module._extensions['.js'];

// Register .md extension handler
Module._extensions['.md'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf-8');
  module._compile(`module.exports = ${JSON.stringify(content)};`, filename);
};
