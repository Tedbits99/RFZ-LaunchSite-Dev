import { describe, expect, it } from 'vitest';
import { readBoundedJson } from './readBoundedJson';

function request(body: string, contentLength?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (contentLength !== undefined) headers.set('content-length', contentLength);
  return new Request('http://127.0.0.1/test', { method: 'POST', headers, body });
}

describe('readBoundedJson', () => {
  it('reads bounded JSON objects and rejects malformed or non-object input', async () => {
    expect(await readBoundedJson(request('{"code":"OK"}'), 64)).toEqual({ code: 'OK' });
    expect(await readBoundedJson(request('{broken'), 64)).toBeNull();
    expect(await readBoundedJson(request('[1,2,3]'), 64)).toBeNull();
  });

  it('rejects oversized declared and streamed bodies', async () => {
    expect(await readBoundedJson(request('{"a":1}', '1024'), 32)).toBeNull();
    expect(await readBoundedJson(request(JSON.stringify({ value: 'x'.repeat(100) })), 32)).toBeNull();
  });

  it('requires JSON content type and a positive safe byte limit', async () => {
    const wrongType = new Request('http://127.0.0.1/test', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"ok":true}',
    });
    expect(await readBoundedJson(wrongType, 64)).toBeNull();
    expect(await readBoundedJson(request('{}'), 0)).toBeNull();
  });
});
