// Checks and normalises a render payload from the Worker before any work starts.
export const MOTIONS = ['zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp'];
const KINDS = ['hook', 'chapter', 'end'];

// Voice URLs are required, so a bad one is an error. Pictures, clips and music
// have fallbacks (cover -> plain colour, no music), so a bad one is dropped with
// a warning instead of failing the whole render (`soft`).
function checkUrl(u, allowedHosts, where, errors, soft, warnings) {
  u = String(u || '');
  if (!u) return '';
  let parsed;
  let problem = '';
  try {
    parsed = new URL(u);
    if (parsed.protocol !== 'https:') problem = 'must be https';
    else if (!allowedHosts.includes(parsed.hostname)) problem = 'host not allowed (' + parsed.hostname + ')';
  } catch (e) {
    problem = 'not a URL';
  }
  if (!problem) return u;
  if (soft) {
    warnings.push(where + ': skipped, ' + problem);
    return '';
  }
  errors.push(where + ': ' + problem);
  return '';
}

export function validatePlan(payload, allowedHosts) {
  const errors = [];
  const warnings = [];
  const p = payload || {};
  const out = {};
  out.jobId = String(p.jobId || '');
  if (!/^rj_[a-z0-9]{6,40}$/.test(out.jobId)) errors.push('jobId invalid');
  out.bookId = String(p.bookId || '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(out.bookId)) errors.push('bookId invalid');
  out.version = p.version;
  if (out.version !== 'en' && out.version !== 'ja') errors.push('version must be en or ja');
  out.accent = p.accent == null || p.accent === '' ? '#00e5a0' : String(p.accent);
  if (!/^#[0-9a-f]{6}$/i.test(out.accent)) errors.push('accent invalid');
  const music = p.music || {};
  const vol = Number(music.volume);
  out.music = {
    url: checkUrl(music.url, allowedHosts, 'music', errors, true, warnings),
    volume: Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.18,
  };
  const scenes = Array.isArray(p.scenes) ? p.scenes : [];
  if (scenes.length < 1 || scenes.length > 10) errors.push('need 1 to 10 scenes');
  out.scenes = scenes.slice(0, 10).map((s, i) => {
    s = s || {};
    const where = 'scene ' + (i + 1);
    if (!KINDS.includes(s.kind)) errors.push(where + ': kind invalid');
    const motion = s.motion == null || s.motion === '' ? 'zoomIn' : s.motion;
    if (!MOTIONS.includes(motion)) errors.push(where + ': motion invalid');
    const durSec = Number(s.durSec);
    if (!(durSec >= 1 && durSec <= 8)) errors.push(where + ': durSec must be 1 to 8');
    const cap = s.caption || {};
    return {
      kind: s.kind,
      imageUrl: checkUrl(s.imageUrl, allowedHosts, where + ' picture', errors, true, warnings),
      clipUrl: checkUrl(s.clipUrl, allowedHosts, where + ' clip', errors, true, warnings),
      voiceUrl: checkUrl(s.voiceUrl, allowedHosts, where + ' voiceUrl', errors, false, warnings),
      motion,
      durSec,
      caption: { main: String(cap.main || '').slice(0, 300), sub: String(cap.sub || '').slice(0, 300) },
      highlight: (Array.isArray(s.highlight) ? s.highlight : []).map((h) => String(h || '').trim()).filter(Boolean).slice(0, 2),
    };
  });
  const o = p.output || {};
  out.output = { mp4Key: String(o.mp4Key || ''), posterKey: String(o.posterKey || '') };
  if (!/^campaign-videos\/[A-Za-z0-9_\/.-]+\.mp4$/.test(out.output.mp4Key)) errors.push('output.mp4Key invalid');
  if (!/^campaign-videos\/[A-Za-z0-9_\/.-]+\.jpg$/.test(out.output.posterKey)) errors.push('output.posterKey invalid');
  if (out.output.mp4Key.includes('..') || out.output.posterKey.includes('..')) errors.push('output key invalid');
  out.warnings = warnings;
  return { ok: errors.length === 0, errors, warnings, plan: out };
}
