// Renders one validated payload into an MP4 + poster on local disk.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { download } from './download.js';
import { buildAss } from './captions.js';
import { sceneArgs, joinArgs, audioArgs, muxArgs, posterArgs } from './ffmpeg.js';
import { sceneStarts, totalDuration } from './timeline.js';

function runFfmpeg(step, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-8000); });
    const onAbort = () => child.kill('SIGKILL');
    if (signal) {
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (e) => reject(new Error('ffmpeg ' + step + ': ' + e.message)));
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('ffmpeg ' + step + ': aborted'));
      if (code === 0) return resolve();
      const tail = err.trim().split('\n').slice(-6).join('\n');
      reject(new Error('ffmpeg ' + step + ': ' + (tail || 'exit code ' + code)));
    });
  });
}

function probeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString();
  return Number(out.trim()) || 0;
}

const extOf = (url, fallback) => {
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : fallback;
};

export async function renderJob(plan, { workDir, allowedHosts = [], allowHttp = false, onProgress = () => {}, signal } = {}) {
  fs.mkdirSync(workDir, { recursive: true });
  const warnings = Array.isArray(plan.warnings) ? plan.warnings.slice() : [];
  const dl = (url, name) => (url ? download(url, path.join(workDir, name), { allowedHosts, allowHttp }) : Promise.resolve(false));
  const scenes = plan.scenes;

  onProgress('downloading', 5);
  const files = await Promise.all(scenes.map(async (s, i) => {
    const img = 'img' + i + '.' + extOf(s.imageUrl, 'jpg');
    const clip = 'clip' + i + '.' + extOf(s.clipUrl, 'mp4');
    const voice = 'voice' + i + '.' + extOf(s.voiceUrl, 'mp3');
    const [hasImg, hasClip, hasVoice] = await Promise.all([dl(s.imageUrl, img), dl(s.clipUrl, clip), dl(s.voiceUrl, voice)]);
    return {
      img: hasImg ? path.join(workDir, img) : null,
      clip: hasClip ? path.join(workDir, clip) : null,
      voice: hasVoice ? path.join(workDir, voice) : null,
    };
  }));
  const musicFile = path.join(workDir, 'music.' + extOf(plan.music && plan.music.url, 'mp3'));
  const hasMusic = await dl(plan.music && plan.music.url, path.basename(musicFile));
  if (plan.music && plan.music.url && !hasMusic) warnings.push('music missing, rendered without it');
  const cover = (files.find((f) => f.img) || {}).img || null;

  const durs = scenes.map((s) => s.durSec);
  const scenePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    if (signal && signal.aborted) throw new Error('aborted');
    const s = scenes[i];
    const f = files[i];
    onProgress('scene ' + (i + 1) + '/' + scenes.length, Math.round(10 + (60 * i) / scenes.length));
    let inPath = f.clip || f.img;
    const isClip = !!f.clip;
    if (s.clipUrl && !f.clip) warnings.push('scene ' + (i + 1) + ': clip missing, used picture');
    if (!inPath) {
      inPath = cover;
      if (s.imageUrl) warnings.push('scene ' + (i + 1) + ': image missing, used ' + (cover ? 'cover' : 'colour'));
    }
    const assPath = path.join(workDir, 'cap' + i + '.ass');
    fs.writeFileSync(assPath, buildAss({ main: s.caption.main, sub: s.caption.sub, highlight: s.highlight, accent: plan.accent }, s.durSec));
    const out = path.join(workDir, 'scene' + i + '.mp4');
    await runFfmpeg('scene ' + (i + 1), sceneArgs({ scene: s, inPath, isClip, assPath, outPath: out, accent: plan.accent }), signal);
    scenePaths.push(out);
  }

  onProgress('joining', 75);
  const video = path.join(workDir, 'video.mp4');
  await runFfmpeg('join', joinArgs(scenePaths, durs, video), signal);

  onProgress('audio', 85);
  const total = totalDuration(durs);
  const starts = sceneStarts(durs);
  const voices = files.map((f, i) => (f.voice ? { path: f.voice, start: starts[i] + 0.1 } : null)).filter(Boolean);
  const audio = path.join(workDir, 'audio.m4a');
  await runFfmpeg('audio', audioArgs({ voices, musicPath: hasMusic ? musicFile : null, musicVolume: plan.music ? plan.music.volume : 0.18, total, outPath: audio }), signal);

  onProgress('encoding', 90);
  const mp4Path = path.join(workDir, 'final.mp4');
  await runFfmpeg('mux', muxArgs(video, audio, mp4Path), signal);
  const posterPath = path.join(workDir, 'poster.jpg');
  await runFfmpeg('poster', posterArgs(mp4Path, posterPath), signal);
  return { mp4Path, posterPath, durationSec: Number(probeDuration(mp4Path).toFixed(2)), warnings };
}
