"""
Convert MP3 / WAV speech audio into a .vcb voice file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

import numpy as np
import librosa
from pydub import AudioSegment

from .voice import Voice


def _load_audio(path: Union[str, Path], target_sr: int = 22050) -> tuple[np.ndarray, int]:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {path}")
    try:
        y, sr = librosa.load(str(path), sr=target_sr, mono=True)
        return y.astype(np.float32), sr
    except Exception:
        audio = AudioSegment.from_file(str(path))
        audio = audio.set_channels(1).set_frame_rate(target_sr)
        samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
        samples /= 1 << (8 * audio.sample_width - 1)
        return samples, target_sr


def _extract_features(y: np.ndarray, sr: int) -> dict:
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
    mfcc_mean = mfcc.mean(axis=1).tolist()
    mfcc_std = mfcc.std(axis=1).tolist()

    f0, voiced_flag, _ = librosa.pyin(
        y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr,
    )
    f0_valid = f0[~np.isnan(f0)] if f0 is not None else np.array([])

    if len(f0_valid) > 0:
        pitch_mean = float(np.mean(f0_valid))
        pitch_std = float(np.std(f0_valid))
        pitch_min = float(np.min(f0_valid))
        pitch_max = float(np.max(f0_valid))
    else:
        pitch_mean = pitch_std = pitch_min = pitch_max = 0.0

    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    spectral_bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    spectral_rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zero_crossing_rate = float(np.mean(librosa.feature.zero_crossing_rate(y)))
    rms = float(np.mean(librosa.feature.rms(y=y)))
    formants = _estimate_formants(y, sr)

    return {
        "mfcc_mean": mfcc_mean,
        "mfcc_std": mfcc_std,
        "pitch_mean": pitch_mean,
        "pitch_std": pitch_std,
        "pitch_min": pitch_min,
        "pitch_max": pitch_max,
        "spectral_centroid": spectral_centroid,
        "spectral_bandwidth": spectral_bandwidth,
        "spectral_rolloff": spectral_rolloff,
        "zero_crossing_rate": zero_crossing_rate,
        "rms": rms,
        "formants": formants,
    }


def _estimate_formants(y: np.ndarray, sr: int, order: int = 12) -> list[float]:
    try:
        frame_length = min(len(y), int(0.05 * sr))
        hop = frame_length // 2
        energies = [np.sum(y[i:i+frame_length]**2) for i in range(0, len(y)-frame_length, hop)]
        if not energies:
            return [500.0, 1500.0, 2500.0]
        best_idx = int(np.argmax(energies)) * hop
        frame = y[best_idx:best_idx+frame_length] * np.hanning(frame_length)
        a = librosa.lpc(frame, order=order)
        roots = np.roots(a)
        roots = roots[np.imag(roots) >= 0]
        angles = np.angle(roots)
        freqs = sorted(angles * (sr / (2 * np.pi)))
        formants = [float(f) for f in freqs if 90 < f < sr/2][:4]
        while len(formants) < 3:
            formants.append(formants[-1]*1.5 if formants else 500.0)
        return formants[:4]
    except Exception:
        return [500.0, 1500.0, 2500.0, 3500.0]


def convert_audio_to_vcb(
    audio_path: Union[str, Path],
    output_path: Optional[Union[str, Path]] = None,
    voice_name: Optional[str] = None,
    sample_rate: int = 22050,
    keep_snippet: bool = True,
) -> Path:
    audio_path = Path(audio_path)
    if voice_name is None:
        voice_name = audio_path.stem
    if output_path is None:
        output_path = audio_path.with_name(f"{voice_name}.vcb")
    else:
        output_path = Path(output_path)

    y, sr = _load_audio(audio_path, target_sr=sample_rate)
    duration = len(y) / sr
    features = _extract_features(y, sr)
    snippet = y[:sr*5] if keep_snippet else None

    voice = Voice(name=voice_name, sample_rate=sr, duration=duration, features=features, audio_snippet=snippet)
    return voice.save(output_path).resolve()
