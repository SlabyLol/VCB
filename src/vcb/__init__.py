"""
VCB - Voice Conversion Binary
=============================

Convert speech audio (MP3 / WAV) into portable .vcb voice files
and synthesize speech using those custom voices.

Copyright (c) 2026 DarkFox / DarkFox Co.
Licensed under the MIT License.
"""

from .voice import Voice
from .convert import convert_audio_to_vcb
from .synthesize import synthesize
from .cli import main

__version__ = "1.0.0"
__author__ = "DarkFox"
__license__ = "MIT"
__copyright__ = "Copyright (c) 2026 DarkFox / DarkFox Co."

__all__ = [
    "Voice",
    "convert_audio_to_vcb",
    "synthesize",
    "main",
    "__version__",
]
