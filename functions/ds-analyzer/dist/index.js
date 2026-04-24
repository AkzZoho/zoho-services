/**
 * Catalyst Advanced I/O entrypoint.
 * Catalyst calls module.exports with (req, res) — we delegate to our Express app.
 */
const app = require('./app');

module.exports = (req, res) => app(req, res);
