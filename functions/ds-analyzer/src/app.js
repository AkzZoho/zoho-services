const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const analyzeRoute = require('./ds-analyser/routes/analyze');
const inspectRoute = require('./ds-analyser/routes/inspect');
const extractScopeRoute = require('./tech-scope/routes/extractScope');
const applyPromptRoute = require('./tech-scope/routes/applyPrompt');
const suggestChangesRoute = require('./ds-analyser/routes/suggestChanges');
const findUsagesRoute = require('./ds-analyser/routes/findUsages');
const changeRequestRoute = require('./ds-analyser/routes/changeRequest');
const adminToolVisibilityRoute = require('./admin/routes/toolVisibility');
const healthRoute = require('./ds-analyser/routes/health');
const errorHandler = require('./shared/middleware/errorHandler');

const app = express();

// Trust the first proxy hop (any reverse proxy / load-balancer in front of us)
// so that express-rate-limit sees the real client IP via X-Forwarded-For,
// rather than the internal proxy address (which would bucket all users under
// the same IP and exhaust the rate limit instantly).
app.set('trust proxy', 1);

// --- Security middleware ---
// helmet defaults are sensible, but we need two overrides:
//   1. CSP: allow `data:` URIs for the inline SVG favicon in index.html.
//   2. Cross-Origin-Resource-Policy: "cross-origin" lets static assets be
//      served from a different origin than the API.
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
// In production the SPA and the API may be on different origins, so we must
// send explicit CORS headers on every response including preflight OPTIONS.
//
// CORS_ALLOWED_ORIGINS (comma-separated) can be set in the server env to
// restrict to known origins. If unset, all origins are allowed (safe for a
// read-only public API; tighten if you add auth).
const rawAllowed = process.env.CORS_ALLOWED_ORIGINS || '';
const allowedOrigins = rawAllowed
  .split(',')
  .map((o) => o.trim())
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

// 6 MB JSON limit accommodates:
//   - /api/suggest-changes: full /api/inspect overview, which for large
//     customer apps with hundreds of workflows can reach 2–5 MB before the
//     route slims it down to a digest. Multipart uploads use multer and
//     have their own limit (controlled by MAX_UPLOAD_MB).
app.use(express.json({ limit: '6mb' }));

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
// All routes mounted under '/'. The SPA calls /api/* and /health directly.
// When running behind a reverse proxy that adds a prefix, configure the proxy
// to strip the prefix before forwarding to this Express app.
const apiRouter = express.Router();
apiRouter.use('/health', healthRoute);
apiRouter.use('/api/inspect', analyzeLimiter, inspectRoute);
apiRouter.use('/api/analyze', analyzeLimiter, analyzeRoute);
apiRouter.use('/api/extract-scope', analyzeLimiter, extractScopeRoute);
apiRouter.use('/api/apply-prompt', analyzeLimiter, applyPromptRoute);
apiRouter.use('/api/suggest-changes', analyzeLimiter, suggestChangesRoute);
apiRouter.use('/api/find-usages', analyzeLimiter, findUsagesRoute);
// /api/change-request — unified Step-2 endpoint that orchestrates a
// deterministic rename extractor + the LLM change planner + the find-usages
// scanner into a single Developer Change Sheet response. This is what the
// new single-prompt UI calls. The older /api/suggest-changes and
// /api/find-usages remain mounted for backwards compatibility with the
// audit mode and any external scripts.
apiRouter.use('/api/change-request', analyzeLimiter, changeRequestRoute);

// /api/admin/* — admin-only endpoints, gated by the `x-admin-password`
// header inside each route. Not rate-limited (admin actions are rare and a
// stuck limiter would lock the admin out of their own panel).
apiRouter.use('/api/admin/tool-visibility', adminToolVisibilityRoute);

app.use('/', apiRouter);

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- Central error handler ---
app.use(errorHandler);

module.exports = app;
