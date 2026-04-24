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
