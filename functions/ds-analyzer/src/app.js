const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const analyzeRoute = require('./routes/analyze');
const inspectRoute = require('./routes/inspect');
const healthRoute = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Trust the first proxy hop (Catalyst's load-balancer) so that
// express-rate-limit sees the real client IP via X-Forwarded-For,
// rather than the internal proxy address (which would bucket all
// users under the same IP and exhaust the rate limit instantly).
app.set('trust proxy', 1);

// --- Security middleware ---
// helmet defaults are sensible, but we need two overrides:
//   1. CSP: allow `data:` URIs for the inline SVG favicon in index.html.
//   2. Cross-Origin-Resource-Policy: "cross-origin" lets Catalyst's CDN
//      serve the static assets from a different origin than the API.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Allow the inline SVG favicon (data: URI in <link rel="icon">)
        'img-src': ["'self'", 'data:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
// CORS — allow any origin that may host the SPA.
// In production the SPA runs on Catalyst Slate (*.onslate.in) which is a
// different origin from the function (*.catalystserverless.com), so we must
// send explicit CORS headers on every response including preflight OPTIONS.
//
// CORS_ALLOWED_ORIGINS (comma-separated) can be set in the Catalyst function
// env to restrict to known origins.  If unset, all origins are allowed (safe
// for a read-only public API; tighten if you add auth).
const rawAllowed = process.env.CORS_ALLOWED_ORIGINS || '';
const allowedOrigins = rawAllowed
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins.length > 0
        ? (origin, callback) => {
            // Allow server-to-server (no Origin header) and listed origins.
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error(`CORS: origin ${origin} not allowed`));
            }
          }
        : true, // allow all origins when env var is not set
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
  })
);
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
// The Catalyst platform STRIPS the function prefix before invoking the
// handler.  A request to:
//   https://<project>.catalystapps.com/server/ds-analyzer/api/inspect
// arrives at Express as simply:
//   /api/inspect
//
// The same path is used locally (via Vite proxy) so a single mount works
// in every environment.  The old dual-mount at '/server/ds-analyzer' was
// wrong and has been removed.
const apiRouter = express.Router();
apiRouter.use('/health', healthRoute);
apiRouter.use('/api/inspect', analyzeLimiter, inspectRoute);
apiRouter.use('/api/analyze', analyzeLimiter, analyzeRoute);

app.use('/', apiRouter);

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- Central error handler ---
app.use(errorHandler);

module.exports = app;
