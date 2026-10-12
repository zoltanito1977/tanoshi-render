// Tanoshi render service: accepts signed render jobs from the tanoshi77 Worker,
// renders them one at a time with ffmpeg, uploads to R2, and reports back.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validatePlan } from './plan.js';
import { sign } from './sign.js';
import { renderJob } from './render.js';
import { makeR2 } from './r2.js';

const MAX_BODY = 1024 * 1024;

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export function createServer({ secret, callbackUrl, callbackSecret, allowedHosts, r2, render = renderJob, jobTimeoutMs = 900000, workRoot = os.tmpdir(), callbackRetryMs = 2000 }) {
  const queue = [];
  let busy = false;

  async function callback(body) {
    const raw = JSON.stringify(body);
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tanoshi-sig': sign(raw, callbackSecret) }, body: raw });
        if (r.ok) return;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, callbackRetryMs));
    }
    console.error('[render] callback failed for', body.jobId, body.status);
  }

  async function runOne(plan) {
    const workDir = fs.mkdtempSync(path.join(workRoot, plan.jobId + '-'));
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, jobTimeoutMs);
    let lastSent = 0;
    const progress = (stage, pct) => {
      const now = Date.now();
      if (now - lastSent < 3000) return;
      lastSent = now;
      callback({ jobId: plan.jobId, status: 'rendering', stage, progress: pct });
    };
    try {
      lastSent = Date.now();
      await callback({ jobId: plan.jobId, status: 'rendering', stage: 'starting', progress: 1 });
      const out = await render(plan, { workDir, allowedHosts, onProgress: progress, signal: ac.signal });
      if (timedOut) throw new Error('aborted');
      await callback({ jobId: plan.jobId, status: 'uploading', stage: 'uploading', progress: 95 });
      const mp4Url = await r2.upload(plan.output.mp4Key, out.mp4Path, 'video/mp4');
      const posterUrl = await r2.upload(plan.output.posterKey, out.posterPath, 'image/jpeg');
      await callback({ jobId: plan.jobId, status: 'done', stage: 'done', progress: 100, mp4Url, posterUrl, durationSec: out.durationSec, warnings: out.warnings || [] });
    } catch (e) {
      const error = timedOut ? 'timed out after ' + Math.round(jobTimeoutMs / 60000) + ' min' : String((e && e.message) || e).slice(0, 600);
      await callback({ jobId: plan.jobId, status: 'failed', stage: 'failed', progress: 0, error });
    } finally {
      clearTimeout(timer);
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) await runOne(queue.shift());
    } finally {
      busy = false;
    }
  }

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, busy, queue: queue.length });
    if (req.method === 'POST' && req.url === '/render') {
      if (!sameSecret(req.headers['x-render-secret'], secret)) return send(res, 401, { error: 'unauthorized' });
      let size = 0;
      const chunks = [];
      let tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) tooBig = true;
        else chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return send(res, 413, { error: 'body too large' });
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (e) {
          return send(res, 400, { errors: ['invalid JSON'] });
        }
        const v = validatePlan(body, allowedHosts);
        if (!v.ok) return send(res, 400, { errors: v.errors });
        const position = queue.length + (busy ? 1 : 0);
        queue.push(v.plan);
        send(res, 202, { accepted: true, position });
        pump();
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const need = ['RENDER_SECRET', 'CALLBACK_URL', 'CALLBACK_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE', 'ALLOWED_HOSTS'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[render] missing environment settings: ' + missing.join(', '));
    process.exit(1);
  }
  const env = process.env;
  const server = createServer({
    secret: env.RENDER_SECRET,
    callbackUrl: env.CALLBACK_URL,
    callbackSecret: env.CALLBACK_SECRET,
    allowedHosts: env.ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
    r2: makeR2({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET, publicBase: env.R2_PUBLIC_BASE }),
  });
  const port = Number(env.PORT) || 10000;
  server.listen(port, () => console.log('[render] listening on ' + port));
}
