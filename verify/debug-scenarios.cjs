const fs = require('fs');
const path = require('path');

const capturePath = path.join(__dirname, 'capture.mjs');
const content = fs.readFileSync(capturePath, 'utf8');

// Extract SCENARIOS object
const scenariosMatch = content.match(/export const SCENARIOS = {(.*?)}/s);
if (scenariosMatch) {
  const scenariosStr = scenariosMatch[1];
  console.log('SCENARIOS string:', scenariosStr.substring(0, 500));
}

// Try to evaluate the capture module as CommonJS
try {
  const module = { exports: {} };
  const func = new Function('module', 'exports', content);
  func(module, module.exports);
  console.log('serve scenarios:', module.exports.scenariosFor('serve').map(s => ({name: s.name, id: s.id})));
} catch (e) {
  console.error('Error evaluating module:', e.message);
}
