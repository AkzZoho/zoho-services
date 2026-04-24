const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const analyzeRoute = require('./routes/analyze');
const inspectRoute = require('./routes/inspect');
const healthRoute = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// --- Security middleware ---
app.use(helmet());
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Basic DoS protection on the public analyze endpoint.
// Disabled under NODE_ENV=test so automated suites (which may issue many
// rapid requests) don't trip the limiter and cause order-dependent flakes.
// Production & development behaviour is unchanged.
const analyzeLimiter =
  process.env.NODE_ENV === 'test'
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please wait a minute.' },
      });

// --- Routes ---
app.use('/health', healthRoute);
app.use('/api/inspect', analyzeLimiter, inspectRoute);
app.use('/api/analyze', analyzeLimiter, analyzeRoute);

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// --- Central error handler ---
app.use(errorHandler);

module.exports = app;
