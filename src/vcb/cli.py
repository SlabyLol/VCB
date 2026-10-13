"""
Command-line interface for VCB.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .convert import convert_audio_to_vcb
from .synthesize import synthesize
from .voice import Voice


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="vcb",
        description="VCB - Voice Conversion Binary. Convert speech to .vcb and synthesize with custom voices.",
        epilog="Copyright (c) 2026 DarkFox / DarkFox Co.  MIT License.",
    )
    parser.add_argument("--version", action="version", version=f"vcb {__version__}")

    sub = parser.add_subparsers(dest="command", required=True)

    # convert
    p_conv = sub.add_parser("convert", help="Convert MP3/WAV speech audio to a .vcb voice file")
    p_conv.add_argument("audio", type=str, help="Path to input audio (mp3, wav, ...)")
    p_conv.add_argument("-o", "--output", type=str, default=None, help="Output .vcb path")
    p_conv.add_argument("-n", "--name", type=str, default=None, help="Voice name stored inside the file")
    p_conv.add_argument("--sr", type=int, default=22050, help="Analysis sample rate (default 22050)")
    p_conv.add_argument("--no-snippet", action="store_true", help="Do not embed audio snippet")

    # speak
    p_speak = sub.add_parser("speak", help="Synthesize speech using a .vcb voice")
    p_speak.add_argument("vcb", type=str, help="Path to the .vcb voice file")
    p_speak.add_argument("text", type=str, help="Text to speak")
    p_speak.add_argument("-o", "--output", type=str, default="output.wav", help="Output WAV path")
    p_speak.add_argument("--duration", type=float, default=None, help="Forced duration in seconds")

    # info
    p_info = sub.add_parser("info", help="Show information about a .vcb file")
    p_info.add_argument("vcb", type=str, help="Path to the .vcb voice file")

    args = parser.parse_args(argv)

    if args.command == "convert":
        out = convert_audio_to_vcb(
            audio_path=args.audio,
            output_path=args.output,
            voice_name=args.name,
            sample_rate=args.sr,
            keep_snippet=not args.no_snippet,
        )
        print(f"Created: {out}")
        return 0

    if args.command == "speak":
        voice = Voice.load(args.vcb)
        synthesize(
            text=args.text,
            voice=voice,
            output_path=args.output,
            duration=args.duration,
        )
        print(f"Synthesized speech written to: {args.output}")
        return 0

    if args.command == "info":
        voice = Voice.load(args.vcb)
        print(f"Name          : {voice.name}")
        print(f"Sample rate   : {voice.sample_rate} Hz")
        print(f"Duration      : {voice.duration:.2f} s")
        print(f"Pitch mean    : {voice.features.get('pitch_mean', 0):.1f} Hz")
        print(f"Pitch range   : {voice.features.get('pitch_min', 0):.1f} – {voice.features.get('pitch_max', 0):.1f} Hz")
        print(f"Formants      : {voice.features.get('formants', [])}")
        print(f"Has snippet   : {voice.audio_snippet is not None}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
