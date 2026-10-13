"""
Synthesize speech using a VCB voice model.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

import numpy as np
from scipy import signal
from scipy.io import wavfile

from .voice import Voice


def _generate_base_tone(text: str, duration: float, sample_rate: int, pitch_mean: float) -> np.ndarray:
    words = text.strip().split()
    if not words:
        words = ["ah"]
    n_syllables = max(1, sum(max(1, len(w) // 2) for w in words))
    base_duration = max(0.4, n_syllables / 4.0)
    if duration is not None and duration > 0:
        base_duration = duration

    t = np.linspace(0, base_duration, int(sample_rate * base_duration), endpoint=False)
    f0 = pitch_mean if pitch_mean > 50 else 140.0
    vibrato = 3.0 * np.sin(2 * np.pi * 5.5 * t)
    pitch_contour = f0 + vibrato + 8.0 * np.sin(2 * np.pi * 0.7 * t)
    phase = 2 * np.pi * np.cumsum(pitch_contour) / sample_rate
    excitation = np.sin(phase)
    noise = np.random.randn(len(t)) * 0.08
    excitation = 0.85 * excitation + 0.15 * noise

    envelope = np.ones_like(t)
    fade = int(0.03 * sample_rate)
    if fade > 0 and len(envelope) > 2 * fade:
        envelope[:fade] = np.linspace(0, 1, fade)
        envelope[-fade:] = np.linspace(1, 0, fade)
    am = 0.15 * np.sin(2 * np.pi * 3.2 * t)
    envelope = np.clip(envelope * (1.0 + am), 0, 1.2)
    return (excitation * envelope).astype(np.float32)


def _apply_voice_timbre(signal_in: np.ndarray, sample_rate: int, features: dict) -> np.ndarray:
    formants = features.get("formants", [500.0, 1500.0, 2500.0])
    spectral_centroid = features.get("spectral_centroid", 2000.0)
    rms_target = features.get("rms", 0.1)

    y = signal_in.copy()
    for i, f in enumerate(formants[:3]):
        if f <= 0 or f >= sample_rate / 2:
            continue
        bw = 80 + i * 40
        Q = f / bw
        b, a = signal.iirpeak(f / (sample_rate / 2), Q)
        y = signal.lfilter(b, a, y)

    if spectral_centroid > 2500:
        sos = signal.butter(2, 3000 / (sample_rate / 2), btype="high", output="sos")
        y = signal.sosfilt(sos, y) * 0.3 + y * 0.7
    elif spectral_centroid < 1500:
        sos = signal.butter(2, 2500 / (sample_rate / 2), btype="low", output="sos")
        y = signal.sosfilt(sos, y)

    current_rms = np.sqrt(np.mean(y ** 2)) + 1e-8
    y = y * (rms_target / current_rms)
    y = np.tanh(y * 1.4) * 0.85
    return y.astype(np.float32)


def synthesize(
    text: str,
    voice: Union[Voice, str, Path],
    output_path: Optional[Union[str, Path]] = None,
    duration: Optional[float] = None,
    sample_rate: Optional[int] = None,
) -> np.ndarray:
    if isinstance(voice, (str, Path)):
        voice = Voice.load(voice)
    if not isinstance(voice, Voice):
        raise TypeError("voice must be a Voice instance or path to a .vcb file")

    sr = sample_rate or voice.sample_rate
    pitch = voice.features.get("pitch_mean", 140.0)
    base = _generate_base_tone(text, duration or 0.0, sr, pitch)
    audio = _apply_voice_timbre(base, sr, voice.features)

    if output_path is not None:
        output_path = Path(output_path)
        pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
        wavfile.write(str(output_path), sr, pcm)
    return audio
