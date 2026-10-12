// HMAC-SHA256 request signing shared with the tanoshi77 Worker.
// Header: X-Tanoshi-Sig: t=<unix seconds>,v1=<hex HMAC(secret, t + "." + rawBody)>
import { createHmac, timingSafeEqual } from 'node:crypto';

export function sign(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  return 't=' + t + ',v1=' + mac;
}

export function verify(header, rawBody, secret, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header || ''));
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > maxAgeSec) return false;
  const want = Buffer.from(sign(rawBody, secret, t).split('v1=')[1], 'hex');
  const got = Buffer.from(m[2], 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
