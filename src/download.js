// Downloads one asset to disk. Returns false (never throws) for refused hosts,
// non-2xx responses or files over the size cap, so a missing picture can fall back.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

export async function download(url, destPath, { allowedHosts = [], maxBytes = 200 * 1024 * 1024, allowHttp = false, timeoutMs = 120000 } = {}) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch (e) {
    return false;
  }
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) return false;
  if (!allowedHosts.includes(u.hostname)) return false;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: ac.signal, redirect: 'error' });
    if (!res.ok || !res.body) return false;
    let seen = 0;
    const cap = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > maxBytes) cb(new Error('file too large'));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), cap, fs.createWriteStream(destPath));
    return true;
  } catch (e) {
    try { fs.rmSync(destPath, { force: true }); } catch (_) {}
    return false;
  } finally {
    clearTimeout(timer);
  }
}
