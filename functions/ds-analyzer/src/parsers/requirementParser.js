/**
 * @deprecated
 * Requirement document parser: PDF, DOCX, or public Zoho Sheet URL.
 *
 * Used only by `analyzer/index.js` (the two-step LLM pipeline).
 * The UI no longer uses this code path — only `POST /api/inspect` is
 * called now. Keep until `routes/analyze.js` is formally removed.
 *
 * Security properties are retained and fully tested in
 * `tests/requirementParser.test.js`.
 */
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { ApiError } = require('../utils/errors');

const URL_FETCH_TIMEOUT_MS = 15_000;
const URL_MAX_BYTES = 10 * 1024 * 1024;

async function parseFromBuffer(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(400, 'Empty requirement file');
  }
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return { text: cleanText(data.text), source: fileName, pages: data.numpages };
  }
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: cleanText(value), source: fileName };
  }
  throw new ApiError(400, `Unsupported requirement file type: ${fileName}`);
}

async function parseFromUrl(url) {
  // SSRF protection: only allow http(s) + public hosts.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, 'Invalid requirementUrl');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, 'requirementUrl must be http(s)');
  }
  // Block private/loopback ranges by hostname pattern (coarse but useful).
  const host = parsed.hostname;
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new ApiError(400, 'requirementUrl host not allowed');
  }

  const resp = await axios.get(url, {
    timeout: URL_FETCH_TIMEOUT_MS,
    responseType: 'arraybuffer',
    maxContentLength: URL_MAX_BYTES,
    maxRedirects: 3,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const contentType = String(resp.headers['content-type'] || '').toLowerCase();
  const buf = Buffer.from(resp.data);

  // Zoho Sheet public links typically return HTML or CSV depending on export query param.
  if (contentType.includes('text/csv') || /\.csv(\?|$)/i.test(url)) {
    return { text: cleanText(buf.toString('utf8')), source: url, kind: 'csv' };
  }
  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    return { text: cleanText(stripHtml(buf.toString('utf8'))), source: url, kind: 'html' };
  }
  if (contentType.includes('pdf') || /\.pdf(\?|$)/i.test(url)) {
    const data = await pdfParse(buf);
    return { text: cleanText(data.text), source: url, kind: 'pdf', pages: data.numpages };
  }
  // Fallback: treat as UTF-8
  return { text: cleanText(buf.toString('utf8')), source: url, kind: 'raw' };
}

function cleanText(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

module.exports = { parseFromBuffer, parseFromUrl };
