const fs = require('fs');
const path = require('path');

// Rules now live alongside the DS Analyser tool that consumes them.
// From src/shared/utils/loadRules.js → src/ds-analyser/rules/
const RULES_DIR = path.resolve(__dirname, '../../ds-analyser/rules');

const cache = {};

/**
 * Loads a markdown rule file from /rules. Cached per process.
 * Rules are editable without redeploy — cache is only per warm-function lifetime.
 */
function loadRule(fileName) {
  if (cache[fileName]) return cache[fileName];
  const full = path.join(RULES_DIR, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`Rule file not found: ${fileName}`);
  }
  const content = fs.readFileSync(full, 'utf8');
  cache[fileName] = content;
  return content;
}

function clearRulesCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
}

module.exports = { loadRule, clearRulesCache };
