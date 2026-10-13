<p align="center">
  <img src="assets/banner.svg" alt="VCB Banner" width="100%"/>
</p>

<p align="center">
  <img src="assets/icon.svg" alt="VCB Icon" width="96"/>
</p>

<h1 align="center">VCB – Voice Conversion Binary</h1>

<p align="center">
  <strong>Convert any speech recording (MP3 / WAV) into a portable <code>.vcb</code> voice file<br>
  and synthesize speech with that exact voice.</strong>
</p>

<p align="center">
  <a href="https://pypi.org/project/vcb/"><img src="https://img.shields.io/pypi/v/vcb?color=38bdf8&label=PyPI" alt="PyPI"/></a>
  <a href="https://github.com/SlabyLol/VCB"><img src="https://img.shields.io/github/stars/SlabyLol/VCB?style=social" alt="Stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"/></a>
  <a href="https://github.com/SlabyLol/VCB"><img src="https://img.shields.io/badge/python-3.9%2B-blue" alt="Python"/></a>
  <a href="https://github.com/SlabyLol/VCB/tree/main/js"><img src="https://img.shields.io/badge/JS%20API-ready-brightgreen" alt="JS API"/></a>
</p>

---

## What is VCB?

**VCB** (Voice Conversion Binary) lets you:

1. Take a recording of someone speaking (MP3, WAV, FLAC, …)
2. Convert it into a compact, portable **`.vcb`** file
3. Later load that `.vcb` and make the same voice speak any text you want

Works from **Python** (`import vcb`) and from **JavaScript / TypeScript** (browser + Node).

```
my-recording.wav  →  my-voice-name.vcb  →  "Hello world" spoken in that voice
```

---

## Installation

### Python (PyPI)

```bash
pip install vcb
```

### From source

```bash
git clone https://github.com/SlabyLol/VCB.git
cd VCB
pip install -e .
```

### JavaScript

```bash
cd js
npm install
npm run build
```

---

## Quick Start (Python)

### 1. Convert a voice recording to `.vcb`

```python
from vcb import convert_audio_to_vcb

# Convert any speech audio into a voice model
vcb_path = convert_audio_to_vcb(
    "recording.mp3",          # or .wav, .flac, ...
    voice_name="my-voice",    # optional
)
# → creates my-voice.vcb
```

### 2. Speak with that voice

```python
from vcb import Voice, synthesize

voice = Voice.load("my-voice.vcb")

# Synthesize and save as WAV
audio = synthesize(
    "Hello, this is my cloned voice speaking.",
    voice=voice,
    output_path="hello.wav",
)
```

### 3. Command-line

```bash
# Convert
vcb convert recording.wav -n my-voice -o my-voice.vcb

# Speak
vcb speak my-voice.vcb "Hello from the command line" -o out.wav

# Inspect
vcb info my-voice.vcb
```

---

## Python API Reference

| Function / Class              | Description                                      |
|-------------------------------|--------------------------------------------------|
| `convert_audio_to_vcb(...)`   | Convert MP3/WAV → `.vcb`                         |
| `Voice.load(path)`            | Load a `.vcb` file                               |
| `voice.save(path)`            | Save a Voice object to `.vcb`                    |
| `synthesize(text, voice, ...)`| Generate speech from text using the voice        |
| `vcb` CLI                     | `convert`, `speak`, `info` sub-commands          |

### Example – full workflow

```python
import vcb

# 1. Create the voice model
vcb.convert_audio_to_vcb("speaker.wav", voice_name="alice")

# 2. Load it
voice = vcb.Voice.load("alice.vcb")
print(voice)  # Voice(name='alice', sample_rate=22050, duration=12.34s)

# 3. Speak
vcb.synthesize(
    "The quick brown fox jumps over the lazy dog.",
    voice=voice,
    output_path="alice_says.wav",
)
```

---

## JavaScript / TypeScript API

```ts
import { loadVcbFromUrl, synthesize, speak } from "vcb-js";

// Load a .vcb file
const voice = await loadVcbFromUrl("/voices/alice.vcb");

// Get raw samples
const { samples, sampleRate } = await synthesize(
  "Hello from JavaScript!",
  voice
);

// Or play directly in the browser
await speak("Hello from the browser!", voice);
```

---

## `.vcb` File Format

A `.vcb` file is a compact binary container:

| Offset | Content                          |
|--------|----------------------------------|
| 0–3    | Magic `VCB1`                     |
| 4–5    | Version (uint16 LE)              |
| 6–9    | Compressed metadata size         |
| 10–13  | Compressed audio snippet size    |
| …      | zlib-compressed JSON metadata    |
| …      | zlib-compressed float32 audio    |

Metadata includes:

- Voice name
- Sample rate & duration
- MFCC mean / std
- Pitch statistics (mean, std, min, max)
- Spectral centroid, bandwidth, rolloff
- Formant estimates
- RMS energy

---

## Project Structure

```
VCB/
├── assets/
│   ├── banner.svg
│   └── icon.svg
├── src/vcb/
│   ├── __init__.py
│   ├── voice.py          # Voice class + binary format
│   ├── convert.py        # Audio → .vcb
│   ├── synthesize.py     # Text → speech using .vcb
│   └── cli.py            # Command-line interface
├── js/
│   ├── src/index.ts      # Full JS/TS API
│   └── package.json
├── examples/
├── tests/
├── pyproject.toml
├── LICENSE
└── README.md
```

---

## Requirements

- Python ≥ 3.9
- `numpy`, `scipy`, `librosa`, `soundfile`, `pydub`

Install system dependencies for audio (optional but recommended):

```bash
# Ubuntu / Debian
sudo apt install ffmpeg libsndfile1

# macOS
brew install ffmpeg libsndfile
```

---

## License

MIT License

**Copyright (c) 2026 DarkFox / DarkFox Co.**

See [LICENSE](LICENSE) for full text.

---

<p align="center">
  Made with ❤️ by <strong>DarkFox</strong>
</p>
