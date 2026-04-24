const { parseFromUrl } = require('../src/parsers/requirementParser');

describe('requirementParser.parseFromUrl (SSRF guards)', () => {
  test('rejects non-http protocol', async () => {
    await expect(parseFromUrl('file:///etc/passwd')).rejects.toThrow(/http/);
  });
  test('rejects invalid URL', async () => {
    await expect(parseFromUrl('not a url')).rejects.toThrow(/Invalid/);
  });
  test('rejects localhost', async () => {
    await expect(parseFromUrl('http://localhost/x')).rejects.toThrow(/not allowed/);
  });
  test('rejects 127.x', async () => {
    await expect(parseFromUrl('http://127.0.0.1/x')).rejects.toThrow(/not allowed/);
  });
  test('rejects 10.x', async () => {
    await expect(parseFromUrl('http://10.0.0.1/x')).rejects.toThrow(/not allowed/);
  });
  test('rejects 192.168.x', async () => {
    await expect(parseFromUrl('http://192.168.1.1/x')).rejects.toThrow(/not allowed/);
  });
  test('rejects 172.16-31.x', async () => {
    await expect(parseFromUrl('http://172.20.0.5/x')).rejects.toThrow(/not allowed/);
  });
});
