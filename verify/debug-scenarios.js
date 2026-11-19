const fs = require('fs');
const path = require('path');

const capturePath = path.join(__dirname, 'capture.mjs');
const content = fs.readFileSync(capturePath, 'utf8');

// Extract SCENARIOS object
const scenariosMatch = content.match(/export const SCENARIOS = {(.*?)}/s);
if (scenariosMatch) {
  const scenariosStr = scenariosMatch[1];
  // Parse the scenarios object manually
  const scenarios = {};
  const lines = scenariosStr.split('\n');
  let currentKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith(',')) {
      currentKey = trimmed.replace(/", "/g, '').replace(/",/g, '').replace(/'/g, '');
    } else if (currentKey && trimmed.includes('}')) {
      // End of object
      break;
    }
  }
  console.log('Available scenario keys:', Object.keys(capture.SCENARIOS || {}));
}

// Try to evaluate the capture module differently
try {
  const module = { exports: {} };
  const func = new Function('module', 'exports', content);
  func(module, module.exports);
  console.log('serve scenarios names:', module.exports.scenariosFor('serve').map(s => s.name));
} catch (e) {
  console.error('Error evaluating module:', e.message);
}
