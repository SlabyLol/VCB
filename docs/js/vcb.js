/**
 * VCB Browser / JS API
 * Convert audio to .vcb in browser, load .vcb, synthesize & speak
 * Copyright (c) 2026 DarkFox / DarkFox Co. - MIT License
 */

const VCB_MAGIC = "VCB1";
const VCB_VERSION = 1;

async function compress(data) {
  if (typeof CompressionStream === "undefined") throw new Error("CompressionStream not supported");
  const cs = new CompressionStream("deflate");
  const stream = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(data) {
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream not supported");
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function audioBufferFromBlob(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(ab.slice(0));
  await ctx.close();
  return buf;
}

function getMonoSamples(audioBuffer, targetSr = 22050) {
  const sr = audioBuffer.sampleRate, length = audioBuffer.length, channels = audioBuffer.numberOfChannels;
  let mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += d[i] / channels;
  }
  if (Math.abs(sr - targetSr) < 1) return { samples: mono, sampleRate: sr };
  const ratio = sr / targetSr, newLen = Math.floor(length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = i * ratio, i0 = Math.floor(src), i1 = Math.min(i0 + 1, length - 1), t = src - i0;
    out[i] = mono[i0] * (1 - t) + mono[i1] * t;
  }
  return { samples: out, sampleRate: targetSr };
}

function computeRMS(s) {
  let sum = 0; for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / s.length);
}

function zeroCrossingRate(s) {
  let c = 0; for (let i = 1; i < s.length; i++) if ((s[i] >= 0) !== (s[i-1] >= 0)) c++;
  return c / s.length;
}

function estimatePitch(samples, sampleRate) {
  const minLag = Math.floor(sampleRate / 400), maxLag = Math.floor(sampleRate / 70);
  const win = Math.min(samples.length, Math.floor(0.08 * sampleRate));
  let bestStart = 0, bestE = 0, hop = Math.floor(win / 2);
  for (let i = 0; i + win < samples.length; i += hop) {
    let e = 0; for (let j = 0; j < win; j++) e += samples[i+j]*samples[i+j];
    if (e > bestE) { bestE = e; bestStart = i; }
  }
  const seg = samples.subarray(bestStart, bestStart + win);
  let bestLag = minLag, bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, n1 = 0, n2 = 0, n = seg.length - lag;
    for (let i = 0; i < n; i++) { corr += seg[i]*seg[i+lag]; n1 += seg[i]*seg[i]; n2 += seg[i+lag]*seg[i+lag]; }
    const r = corr / (Math.sqrt(n1*n2) + 1e-8);
    if (r > bestCorr) { bestCorr = r; bestLag = lag; }
  }
  if (bestCorr < 0.3) return { mean: 140, std: 20, min: 100, max: 200 };
  const f0 = sampleRate / bestLag;
  return { mean: f0, std: f0*0.08, min: f0*0.85, max: f0*1.15 };
}

function spectralFeatures(samples, sampleRate) {
  const N = 1024, hop = 512;
  let cSum = 0, bSum = 0, rSum = 0, frames = 0;
  for (let start = 0; start + N < samples.length; start += hop) {
    const frame = new Float32Array(N);
    for (let i = 0; i < N; i++) frame[i] = samples[start+i] * 0.5 * (1 - Math.cos(2*Math.PI*i/(N-1)));
    const mag = new Float32Array(N/2);
    for (let k = 0; k < N/2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const a = 2*Math.PI*k*n/N; re += frame[n]*Math.cos(a); im -= frame[n]*Math.sin(a); }
      mag[k] = Math.sqrt(re*re + im*im);
    }
    let total = 0, weighted = 0;
    for (let k = 0; k < mag.length; k++) { const f = k*sampleRate/N; total += mag[k]; weighted += mag[k]*f; }
    if (total < 1e-8) continue;
    const centroid = weighted / total;
    let bw = 0;
    for (let k = 0; k < mag.length; k++) { const f = k*sampleRate/N; bw += mag[k]*(f-centroid)*(f-centroid); }
    bw = Math.sqrt(bw/total);
    let cum = 0, rolloff = sampleRate/2;
    for (let k = 0; k < mag.length; k++) { cum += mag[k]; if (cum >= total*0.85) { rolloff = k*sampleRate/N; break; } }
    cSum += centroid; bSum += bw; rSum += rolloff; frames++;
  }
  if (!frames) return { spectral_centroid: 2000, spectral_bandwidth: 1500, spectral_rolloff: 4000 };
  return { spectral_centroid: cSum/frames, spectral_bandwidth: bSum/frames, spectral_rolloff: rSum/frames };
}

function estimateFormants(samples, sampleRate) {
  const N = 2048;
  if (samples.length < N) return [500, 1500, 2500];
  let bestStart = 0, bestE = 0;
  for (let i = 0; i + N < samples.length; i += N/2) {
    let e = 0; for (let j = 0; j < N; j++) e += samples[i+j]*samples[i+j];
    if (e > bestE) { bestE = e; bestStart = i; }
  }
  const frame = new Float32Array(N);
  for (let i = 0; i < N; i++) frame[i] = samples[bestStart+i] * 0.5 * (1 - Math.cos(2*Math.PI*i/(N-1)));
  const mag = new Float32Array(N/2);
  for (let k = 0; k < N/2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const a = 2*Math.PI*k*n/N; re += frame[n]*Math.cos(a); im -= frame[n]*Math.sin(a); }
    mag[k] = Math.sqrt(re*re + im*im);
  }
  const peaks = [];
  for (let k = 2; k < mag.length-2; k++) {
    const freq = k*sampleRate/N;
    if (freq < 200 || freq > 4000) continue;
    if (mag[k] > mag[k-1] && mag[k] > mag[k+1] && mag[k] > mag[k-2] && mag[k] > mag[k+2])
      peaks.push({ freq, mag: mag[k] });
  }
  peaks.sort((a,b) => b.mag - a.mag);
  const formants = [];
  for (const p of peaks) {
    if (formants.every(f => Math.abs(f - p.freq) > 250)) { formants.push(p.freq); if (formants.length >= 4) break; }
  }
  while (formants.length < 3) formants.push(500 + formants.length * 1000);
  return formants.slice(0, 4);
}

function computeMfcc(samples, sampleRate, nMfcc = 20) {
  const N = 1024, nMels = 26, hop = 512;
  const melLow = 2595 * Math.log10(1);
  const melHigh = 2595 * Math.log10(1 + (sampleRate/2)/700);
  const melPoints = [];
  for (let i = 0; i < nMels + 2; i++) {
    const mel = melLow + (i/(nMels+1))*(melHigh-melLow);
    melPoints.push(700 * (Math.pow(10, mel/2595) - 1));
  }
  const means = new Array(nMfcc).fill(0);
  let frames = 0;
  for (let start = 0; start + N < samples.length; start += hop) {
    const frame = new Float32Array(N);
    for (let i = 0; i < N; i++) frame[i] = samples[start+i] * 0.5 * (1 - Math.cos(2*Math.PI*i/(N-1)));
    const mag = new Float32Array(N/2);
    for (let k = 0; k < N/2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const a = 2*Math.PI*k*n/N; re += frame[n]*Math.cos(a); im -= frame[n]*Math.sin(a); }
      mag[k] = Math.sqrt(re*re + im*im);
    }
    const melE = new Array(nMels).fill(0);
    for (let m = 0; m < nMels; m++) {
      const left = melPoints[m], center = melPoints[m+1], right = melPoints[m+2];
      for (let k = 0; k < mag.length; k++) {
        const freq = k*sampleRate/N;
        let w = 0;
        if (freq >= left && freq <= center) w = (freq-left)/(center-left+1e-8);
        else if (freq > center && freq <= right) w = (right-freq)/(right-center+1e-8);
        melE[m] += mag[k] * w;
      }
      melE[m] = Math.log(melE[m] + 1e-8);
    }
    for (let i = 0; i < nMfcc; i++) {
      let sum = 0;
      for (let m = 0; m < nMels; m++) sum += melE[m] * Math.cos(Math.PI*i*(m+0.5)/nMels);
      means[i] += sum;
    }
    frames++;
  }
  if (!frames) return { mfcc_mean: new Array(nMfcc).fill(0), mfcc_std: new Array(nMfcc).fill(0.1) };
  for (let i = 0; i < nMfcc; i++) means[i] /= frames;
  return { mfcc_mean: means, mfcc_std: means.map(m => Math.abs(m)*0.3 + 0.05) };
}

export function extractFeatures(samples, sampleRate) {
  const pitch = estimatePitch(samples, sampleRate);
  const spectral = spectralFeatures(samples, sampleRate);
  const formants = estimateFormants(samples, sampleRate);
  const mfcc = computeMfcc(samples, sampleRate);
  return {
    mfcc_mean: mfcc.mfcc_mean, mfcc_std: mfcc.mfcc_std,
    pitch_mean: pitch.mean, pitch_std: pitch.std, pitch_min: pitch.min, pitch_max: pitch.max,
    spectral_centroid: spectral.spectral_centroid, spectral_bandwidth: spectral.spectral_bandwidth,
    spectral_rolloff: spectral.spectral_rolloff, zero_crossing_rate: zeroCrossingRate(samples),
    rms: computeRMS(samples), formants
  };
}

export async function createVcbBlob(voiceData, audioSnippet = null) {
  const meta = { name: voiceData.name, sample_rate: voiceData.sample_rate, duration: voiceData.duration, features: voiceData.features, version: VCB_VERSION };
  const metaCompressed = await compress(new TextEncoder().encode(JSON.stringify(meta)));
  let audioCompressed = new Uint8Array(0);
  if (audioSnippet && audioSnippet.length > 0) {
    const maxS = voiceData.sample_rate * 5;
    const sn = audioSnippet.length > maxS ? audioSnippet.subarray(0, maxS) : audioSnippet;
    const buf = new ArrayBuffer(sn.length * 4);
    new Float32Array(buf).set(sn);
    audioCompressed = await compress(new Uint8Array(buf));
  }
  const header = new ArrayBuffer(14);
  const hv = new DataView(header);
  hv.setUint8(0,0x56); hv.setUint8(1,0x43); hv.setUint8(2,0x42); hv.setUint8(3,0x31);
  hv.setUint16(4, VCB_VERSION, true);
  hv.setUint32(6, metaCompressed.length, true);
  hv.setUint32(10, audioCompressed.length, true);
  const total = new Uint8Array(14 + metaCompressed.length + audioCompressed.length);
  total.set(new Uint8Array(header), 0);
  total.set(metaCompressed, 14);
  total.set(audioCompressed, 14 + metaCompressed.length);
  return new Blob([total], { type: "application/octet-stream" });
}

export async function convertAudioToVcb(input, options = {}) {
  const voiceName = options.voiceName || options.name || "voice";
  const targetSr = options.sampleRate || 22050;
  const keepSnippet = options.keepSnippet !== false;
  let audioBuffer;
  if (input instanceof AudioBuffer) audioBuffer = input;
  else if (input instanceof Blob || input instanceof File) audioBuffer = await audioBufferFromBlob(input);
  else throw new Error("Input must be AudioBuffer, Blob or File");
  const { samples, sampleRate } = getMonoSamples(audioBuffer, targetSr);
  const features = extractFeatures(samples, sampleRate);
  const voiceData = { name: voiceName, sample_rate: sampleRate, duration: samples.length / sampleRate, features };
  const snippet = keepSnippet ? samples.subarray(0, Math.min(samples.length, sampleRate * 5)) : null;
  const blob = await createVcbBlob(voiceData, snippet);
  return { blob, voice: voiceData };
}

export async function loadVcb(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== VCB_MAGIC) throw new Error("Invalid VCB file: bad magic " + magic);
  const version = view.getUint16(4, true);
  if (version !== VCB_VERSION) throw new Error("Unsupported VCB version: " + version);
  const metaSize = view.getUint32(6, true);
  const metaJson = await decompress(new Uint8Array(buffer, 14, metaSize));
  const meta = JSON.parse(new TextDecoder().decode(metaJson));
  return { name: meta.name, sample_rate: meta.sample_rate, duration: meta.duration, features: meta.features, version: meta.version ?? version };
}

export async function loadVcbFromFile(file) { return loadVcb(await file.arrayBuffer()); }
export async function loadVcbFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch VCB: " + res.status);
  return loadVcb(await res.arrayBuffer());
}

export async function synthesize(text, voice, options = {}) {
  const sampleRate = options.sampleRate ?? voice.sample_rate ?? 22050;
  const pitch = voice.features?.pitch_mean || 140;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const nSyl = Math.max(1, words.reduce((a,w) => a + Math.max(1, Math.floor(w.length/2)), 0));
  const duration = options.duration ?? Math.max(0.5, nSyl / 3.8);
  const length = Math.floor(sampleRate * duration);
  const samples = new Float32Array(length);
  let phase = 0;
  const formants = voice.features?.formants || [500, 1500, 2500];
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const contour = pitch + 3*Math.sin(2*Math.PI*5.5*t) + 8*Math.sin(2*Math.PI*0.7*t);
    phase += 2*Math.PI*contour / sampleRate;
    let sample = Math.sin(phase);
    sample = 0.82*sample + 0.18*(Math.random()*2-1);
    for (let f = 0; f < Math.min(3, formants.length); f++) {
      const ff = formants[f];
      if (ff > 0 && ff < sampleRate/2) sample += 0.11*Math.sin(2*Math.PI*ff*t)/(f+1);
    }
    const fade = Math.floor(0.04*sampleRate);
    let env = 1;
    if (i < fade) env = i/fade; else if (i > length-fade) env = (length-i)/fade;
    env *= 1 + 0.14*Math.sin(2*Math.PI*3.2*t);
    samples[i] = Math.tanh(sample*env*1.25)*0.78;
  }
  const targetRms = voice.features?.rms || 0.1;
  let sumSq = 0; for (let i = 0; i < length; i++) sumSq += samples[i]*samples[i];
  const scale = targetRms / (Math.sqrt(sumSq/length) + 1e-8);
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
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };
  ws(0,"RIFF"); view.setUint32(4, 36+samples.length*2, true); ws(8,"WAVE"); ws(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); ws(36,"data"); view.setUint32(40,samples.length*2,true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s*0x8000 : s*0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default {
  convertAudioToVcb, loadVcb, loadVcbFromFile, loadVcbFromUrl,
  synthesize, speak, encodeWav, extractFeatures, createVcbBlob, audioBufferFromBlob
};
