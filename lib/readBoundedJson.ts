/** Read a JSON object with an actual streamed byte ceiling (not only a
 * Content-Length hint), so chunked requests cannot force unbounded parsing. */
export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown> | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) return null;
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > maximumBytes) return null;
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    try { await reader.cancel(); } catch { /* request already closed */ }
    return null;
  } finally {
    reader.releaseLock();
  }
}
