/**
 * Central error handler. Never leak stack traces or internal paths to the client.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Log full error server-side
  console.error('[ERROR]', {
    path: req.path,
    method: req.method,
    status,
    message: err.message,
    stack: err.stack,
  });

  const body = {
    error: err.expose ? err.message : status >= 500 ? 'Internal server error' : err.message,
    code: err.code || 'INTERNAL_ERROR',
  };

  if (!isProd && status >= 500) {
    body.debug = { message: err.message };
  }

  res.status(status).json(body);
};
