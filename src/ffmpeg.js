// Pure builders for ffmpeg argument lists (no I/O here, so they're unit-testable).
import { sceneStarts, XFADE } from './timeline.js';

export const FPS = 30;
export const FONTS_DIR = process.env.FONTS_DIR || '/usr/share/fonts/opentype/noto';
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
const n = (x) => String(+Number(x).toFixed(3));

function zoompanExpr(motion, d) {
  const cx = "x='iw/2-(iw/zoom/2)'";
  const cy = "y='ih/2-(ih/zoom/2)'";
  switch (motion) {
    case 'zoomOut':
      return "z='1.10-0.10*on/" + d + "':" + cx + ':' + cy;
    case 'panLeft':
      return "z='1.08':x='(iw-iw/zoom)*(1-on/" + d + ")':" + cy;
    case 'panRight':
      return "z='1.08':x='(iw-iw/zoom)*on/" + d + "':" + cy;
    case 'panUp':
      return "z='1.08':" + cx + ":y='(ih-ih/zoom)*(1-on/" + d + ")'";
    case 'zoomIn':
    default:
      return "z='min(1+0.10*on/" + d + ",1.10)':" + cx + ':' + cy;
  }
}

export function darkHex(accent, keep = 0.4) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(accent || '')) || [0, '00e5a0'];
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.floor(c * keep).toString(16).padStart(2, '0'));
  return '0x' + ch.join('');
}

function assFilter(assPath) {
  return "ass=filename='" + assPath + "':fontsdir='" + FONTS_DIR + "'";
}

export function sceneArgs({ scene, inPath, isClip, assPath, outPath, accent }) {
  const dur = n(scene.durSec);
  const d = Math.round(Number(scene.durSec) * FPS);
  const tail = ',setsar=1,format=yuv420p';
  if (isClip) {
    return ['-y', '-i', inPath, '-vf',
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=' + FPS + ',tpad=stop_mode=clone:stop_duration=' + dur + ',' + assFilter(assPath) + tail,
      '-t', dur, '-an', ...ENC, outPath];
  }
  if (!inPath) {
    return ['-y', '-f', 'lavfi', '-i', 'color=c=' + darkHex(accent) + ':s=1080x1920:r=' + FPS + ':d=' + dur, '-vf', assFilter(assPath) + tail,
      '-t', dur, '-an', ...ENC, outPath];
  }
  return ['-y', '-i', inPath, '-vf',
    'scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=' + zoompanExpr(scene.motion, d) + ':d=' + d + ':s=1080x1920:fps=' + FPS + ',' + assFilter(assPath) + tail,
    '-frames:v', String(d), '-an', ...ENC, outPath];
}

export function joinArgs(scenePaths, durs, outPath) {
  if (scenePaths.length === 1) return ['-y', '-i', scenePaths[0], '-c', 'copy', outPath];
  const starts = sceneStarts(durs, XFADE);
  const inputs = scenePaths.flatMap((p) => ['-i', p]);
  const parts = [];
  let prev = '[0:v]';
  for (let i = 1; i < scenePaths.length; i++) {
    const out = i === scenePaths.length - 1 ? '[vout]' : '[x' + i + ']';
    parts.push(prev + '[' + i + ':v]xfade=transition=fade:duration=' + XFADE + ':offset=' + n(starts[i]) + out);
    prev = out;
  }
  return ['-y', ...inputs, '-filter_complex', parts.join(';'), '-map', '[vout]', ...ENC, '-r', String(FPS), outPath];
}

export function audioArgs({ voices = [], musicPath = null, musicVolume = 0.18, total, outPath }) {
  const T = n(total);
  const inputs = [];
  const parts = [];
  voices.forEach((v, i) => {
    inputs.push('-i', v.path);
    const ms = Math.max(0, Math.round(v.start * 1000));
    parts.push('[' + i + ':a]aresample=48000,aformat=channel_layouts=stereo,adelay=' + ms + '|' + ms + '[v' + i + ']');
  });
  let voiceBus = null;
  if (voices.length) {
    const labels = voices.map((_, i) => '[v' + i + ']').join('');
    parts.push(voices.length > 1
      ? labels + 'amix=inputs=' + voices.length + ':normalize=0:duration=longest,apad=whole_dur=' + T + '[vb]'
      : labels + 'apad=whole_dur=' + T + '[vb]');
    voiceBus = '[vb]';
  }
  let musicBus = null;
  if (musicPath) {
    const mi = voices.length;
    inputs.push('-stream_loop', '-1', '-i', musicPath);
    parts.push('[' + mi + ':a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:' + T + ',asetpts=PTS-STARTPTS,volume=' + musicVolume + '[mus]');
    musicBus = '[mus]';
  }
  const fadeSt = n(Math.max(0, total - 2.5));
  if (voiceBus && musicBus) {
    parts.push('[vb]asplit=2[vk][vm]');
    parts.push('[mus][vk]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300,afade=t=out:st=' + fadeSt + ':d=2.5[mf]');
    parts.push('[vm][mf]amix=inputs=2:normalize=0:duration=first[mix]');
  } else if (voiceBus) {
    parts.push('[vb]anull[mix]');
  } else if (musicBus) {
    parts.push('[mus]afade=t=out:st=' + fadeSt + ':d=2.5[mix]');
  } else {
    inputs.push('-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=48000:cl=stereo');
    parts.push('[0:a]anull[mix]');
  }
  parts.push('[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,atrim=0:' + T + '[aout]');
  return ['-y', ...inputs, '-filter_complex', parts.join(';'), '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', outPath];
}

export function muxArgs(videoPath, audioPath, outPath) {
  return ['-y', '-i', videoPath, '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', outPath];
}

export function posterArgs(mp4Path, outPath) {
  return ['-y', '-ss', '1', '-i', mp4Path, '-frames:v', '1', '-q:v', '3', outPath];
}
