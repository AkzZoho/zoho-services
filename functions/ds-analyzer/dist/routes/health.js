const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ds-analyzer',
    version: require('../../package.json').version,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
