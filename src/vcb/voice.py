"""
VCB Voice model and binary format handling.
"""

from __future__ import annotations

import struct
import json
import zlib
from pathlib import Path
from typing import Any, Dict, Optional, Union

import numpy as np

# Magic header for .vcb files
VCB_MAGIC = b"VCB1"
VCB_VERSION = 1


class Voice:
    """
    Represents a VCB voice model.

    A .vcb file stores:
    - Voice name
    - Sample rate
    - Duration of source audio
    - MFCC features (mean + std)
    - Pitch statistics (mean, std, range)
    - Formant estimates
    - Spectral envelope summary
    - Optional raw audio snippet for reference
    """

    def __init__(
        self,
        name: str,
        sample_rate: int,
        duration: float,
        features: Dict[str, Any],
        audio_snippet: Optional[np.ndarray] = None,
    ):
        self.name = name
        self.sample_rate = sample_rate
        self.duration = duration
        self.features = features
        self.audio_snippet = audio_snippet

    def __repr__(self) -> str:
        return (
            f"Voice(name={self.name!r}, "
            f"sample_rate={self.sample_rate}, "
            f"duration={self.duration:.2f}s)"
        )

    def save(self, path: Union[str, Path]) -> Path:
        """Save the voice model to a .vcb file."""
        path = Path(path)
        if path.suffix.lower() != ".vcb":
            path = path.with_suffix(".vcb")

        # Prepare metadata
        meta = {
            "name": self.name,
            "sample_rate": self.sample_rate,
            "duration": self.duration,
            "features": self.features,
            "version": VCB_VERSION,
        }
        meta_json = json.dumps(meta, separators=(",", ":")).encode("utf-8")
        meta_compressed = zlib.compress(meta_json, level=9)

        # Optional audio snippet (float32 mono, max 5 seconds)
        audio_data = b""
        if self.audio_snippet is not None:
            snippet = self.audio_snippet.astype(np.float32)
            max_samples = self.sample_rate * 5
            if len(snippet) > max_samples:
                snippet = snippet[:max_samples]
            audio_data = snippet.tobytes()

        audio_compressed = zlib.compress(audio_data, level=9) if audio_data else b""

        with open(path, "wb") as f:
            # Header
            f.write(VCB_MAGIC)
            f.write(struct.pack("<H", VCB_VERSION))  # version
            f.write(struct.pack("<I", len(meta_compressed)))  # meta size
            f.write(struct.pack("<I", len(audio_compressed)))  # audio size
            # Payload
            f.write(meta_compressed)
            f.write(audio_compressed)

        return path

    @classmethod
    def load(cls, path: Union[str, Path]) -> "Voice":
        """Load a voice model from a .vcb file."""
        path = Path(path)
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic != VCB_MAGIC:
                raise ValueError(f"Invalid VCB file: bad magic {magic!r}")

            version = struct.unpack("<H", f.read(2))[0]
            if version != VCB_VERSION:
                raise ValueError(f"Unsupported VCB version: {version}")

            meta_size = struct.unpack("<I", f.read(4))[0]
            audio_size = struct.unpack("<I", f.read(4))[0]

            meta_compressed = f.read(meta_size)
            audio_compressed = f.read(audio_size)

        meta_json = zlib.decompress(meta_compressed)
        meta = json.loads(meta_json.decode("utf-8"))

        audio_snippet = None
        if audio_size > 0:
            audio_bytes = zlib.decompress(audio_compressed)
            audio_snippet = np.frombuffer(audio_bytes, dtype=np.float32)

        return cls(
            name=meta["name"],
            sample_rate=meta["sample_rate"],
            duration=meta["duration"],
            features=meta["features"],
            audio_snippet=audio_snippet,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Export voice as a plain dictionary (for JS interop etc.)."""
        return {
            "name": self.name,
            "sample_rate": self.sample_rate,
            "duration": self.duration,
            "features": self.features,
        }
