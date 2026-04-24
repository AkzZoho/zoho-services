const { parseDs, _internal } = require('../src/parsers/dsParser');
const AdmZip = require('adm-zip');

describe('dsParser', () => {
  describe('sniff()', () => {
    test('detects zip', () => {
      expect(_internal.sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    });
    test('detects xml', () => {
      expect(_internal.sniff(Buffer.from('<?xml version="1.0"?><a/>'))).toBe('xml');
    });
    test('detects json', () => {
      expect(_internal.sniff(Buffer.from('{"a":1}'))).toBe('json');
    });
    test('unknown for garbage', () => {
      expect(_internal.sniff(Buffer.from('garbage'))).toBe('unknown');
    });
  });

  describe('safeEntryName()', () => {
    test('strips path traversal', () => {
      expect(_internal.safeEntryName('../../etc/passwd')).toBe('etc/passwd');
      expect(_internal.safeEntryName('/abs/path')).toBe('abs/path');
    });
  });

  test('rejects empty buffer', async () => {
    await expect(parseDs(Buffer.alloc(0))).rejects.toThrow(/Empty/);
  });

  test('parses a synthetic JSON .ds', async () => {
    const fake = {
      application: { name: 'TestApp', version: '1.0' },
      forms: [
        {
          name: 'Leads',
          fields: [
            { name: 'Email', type: 'EMAIL', required: true },
            { name: 'Phone', type: 'PHONE' },
          ],
        },
      ],
      workflows: [{ name: 'OnCreateLead', trigger: 'onCreate', target: 'Leads', script: 'info "hi";' }],
    };
    const buf = Buffer.from(JSON.stringify(fake));
    const out = await parseDs(buf, 'test.ds');
    expect(out.application.name).toBe('TestApp');
    expect(out.forms).toHaveLength(1);
    expect(out.forms[0].fields).toHaveLength(2);
    // Normalised output uses `event` (the canonical field name); the fixture
    // used `trigger` as the input key, which maps to `event` during normalisation.
    expect(out.workflows[0].event).toBe('onCreate');
  });

  test('parses a synthetic ZIP containing JSON', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'manifest.json',
      Buffer.from(JSON.stringify({ application: { name: 'Zipped' }, forms: [] }))
    );
    const out = await parseDs(zip.toBuffer(), 'app.ds');
    expect(out._raw.format).toBe('zip');
    expect(out.application.name).toBe('Zipped');
  });

  test('adds warning for unknown format', async () => {
    const out = await parseDs(Buffer.from('garbage-bytes-here'), 'weird.ds');
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});
