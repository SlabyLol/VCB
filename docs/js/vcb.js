/**
 * VCB Browser API – load .vcb voices and synthesize speech
 * Copyright (c) 2026 DarkFox / DarkFox Co. – MIT License
 */

const VCB_MAGIC = "VCB1";
const VCB_VERSION = 1;

async function decompress(data) {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("DecompressionStream not supported in this browser");
}

export async function loadVcb(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== VCB_MAGIC) throw new Error(`Invalid VCB file: bad magic "${magic}"`);

  const version = view.getUint16(4, true);
  if (version !== VCB_VERSION) throw new Error(`Unsupported VCB version: ${version}`);

  const metaSize = view.getUint32(6, true);
  const metaCompressed = new Uint8Array(buffer, 14, metaSize);
  const metaJson = await decompress(metaCompressed);
  const meta = JSON.parse(new TextDecoder().decode(metaJson));

  return {
    name: meta.name,
    sample_rate: meta.sample_rate,
    duration: meta.duration,
    features: meta.features,
    version: meta.version ?? version,
  };
}

export async function loadVcbFromFile(file) {
  return loadVcb(await file.arrayBuffer());
}

export async function synthesize(text, voice, options = {}) {
  const sampleRate = options.sampleRate ?? voice.sample_rate ?? 22050;
  const pitch = voice.features?.pitch_mean || 140;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const nSyllables = Math.max(1, words.reduce((a, w) => a + Math.max(1, Math.floor(w.length / 2)), 0));
  const duration = options.duration ?? Math.max(0.5, nSyllables / 3.8);

  const length = Math.floor(sampleRate * duration);
  const samples = new Float32Array(length);

  let phase = 0;
  const formants = voice.features?.formants || [500, 1500, 2500];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const vibrato = 3 * Math.sin(2 * Math.PI * 5.5 * t);
    const contour = pitch + vibrato + 8 * Math.sin(2 * Math.PI * 0.7 * t);
    phase += (2 * Math.PI * contour) / sampleRate;

    let sample = Math.sin(phase);
    sample = 0.82 * sample + 0.18 * (Math.random() * 2 - 1);

    for (let f = 0; f < Math.min(3, formants.length); f++) {
      const ff = formants[f];
      if (ff > 0 && ff < sampleRate / 2) {
        sample += (0.11 * Math.sin(2 * Math.PI * ff * t)) / (f + 1);
      }
    }

    const fade = Math.floor(0.04 * sampleRate);
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > length - fade) env = (length - i) / fade;
    env *= 1 + 0.14 * Math.sin(2 * Math.PI * 3.2 * t);

    samples[i] = Math.tanh(sample * env * 1.25) * 0.78;
  }

  const targetRms = voice.features?.rms || 0.1;
  let sumSq = 0;
  for (let i = 0; i < length; i++) sumSq += samples[i] * samples[i];
  const currentRms = Math.sqrt(sumSq / length) + 1e-8;
  const scale = targetRms / currentRms;
  for (let i = 0; i < length; i++) samples[i] *= scale;

  return { samples, sampleRate };
}

export async function speak(text, voice, options = {}) {
  const { samples, sampleRate } = await synthesize(text, voice, options);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return source;
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
