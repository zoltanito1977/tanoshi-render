// Burned-in captions as an ASS subtitle file (rendered by libass in ffmpeg).
// Japanese (and other CJK) characters are about twice as wide as Latin ones,
// so line width is measured in "units": CJK/full-width = 2, everything else = 1.
const WIDE = /[ᄀ-ᅟ⺀-〾぀-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function unitsOf(s) {
  let n = 0;
  for (const ch of String(s)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

function tokens(text) {
  const out = [];
  let word = '';
  for (const ch of String(text)) {
    if (/\s/.test(ch)) {
      if (word) out.push(word), (word = '');
      out.push(' ');
    } else if (WIDE.test(ch)) {
      if (word) out.push(word), (word = '');
      out.push(ch);
    } else word += ch;
  }
  if (word) out.push(word);
  return out;
}

export function wrapText(text, maxUnits) {
  const lines = [];
  let cur = '';
  const flush = () => {
    const t = cur.trim();
    if (t) lines.push(t);
    cur = '';
  };
  for (const tok of tokens(String(text || '').replace(/\s+/g, ' ').trim())) {
    if (tok === ' ') {
      if (cur) cur += ' ';
      continue;
    }
    if (unitsOf(cur.trimEnd() ? cur + tok : tok) <= maxUnits) {
      cur = cur + tok;
      continue;
    }
    flush();
    if (unitsOf(tok) <= maxUnits) {
      cur = tok;
      continue;
    }
    for (const ch of tok) {
      if (unitsOf(cur + ch) > maxUnits) flush();
      cur += ch;
    }
  }
  flush();
  return lines;
}

export function accentToAss(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return '&H00A0E500';
  return '&H00' + (m[3] + m[2] + m[1]).toUpperCase();
}

function esc(s) {
  return String(s).replace(/\\/g, '＼').replace(/\{/g, '(').replace(/\}/g, ')');
}

function capLines(lines, max, maxUnits) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && unitsOf(last + '…') > maxUnits) last = Array.from(last).slice(0, -1).join('');
  kept[max - 1] = last + '…';
  return kept;
}

function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + rest.toFixed(2).padStart(5, '0');
}

export const MAIN_UNITS = 26;
export const SUB_UNITS = 44;

export function buildAss({ main = '', sub = '', highlight = [], accent = '#00e5a0' }, durSec) {
  const hl = accentToAss(accent);
  const mainLines = capLines(wrapText(main, MAIN_UNITS), 3, MAIN_UNITS).map((l) => {
    let t = esc(l);
    for (const w of highlight) {
      const ew = esc(String(w || '').trim());
      if (ew) t = t.split(ew).join('{\\c' + hl + '}' + ew + '{\\c&H00FFFFFF}');
    }
    return t;
  });
  const subLines = capLines(wrapText(sub, SUB_UNITS), 2, SUB_UNITS).map(esc);
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Main,Noto Sans CJK JP,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,480,1',
    'Style: Sub,Noto Sans CJK JP,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,90,90,480,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  let text = mainLines.join('\\N');
  if (subLines.length) text += (text ? '\\N' : '') + '{\\rSub}' + subLines.join('\\N');
  if (text) head.push('Dialogue: 0,' + assTime(0.15) + ',' + assTime(durSec - 0.1) + ',Main,,0,0,0,,{\\fad(150,150)}' + text);
  return head.join('\n') + '\n';
}
