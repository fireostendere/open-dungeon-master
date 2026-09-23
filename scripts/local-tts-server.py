#!/usr/bin/env python3
import io
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
import wave

import numpy as np
import torch
from torch.package import PackageImporter

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("ODM_LOCAL_TTS_CACHE", ROOT / "node_modules" / ".cache" / "odm-tts"))
MODEL_PATH = Path(os.environ.get("ODM_LOCAL_TTS_MODEL_PATH", CACHE / "v5_5_ru.pt"))
PORT = int(os.environ.get("ODM_LOCAL_TTS_PORT", "8875"))
TOKEN = os.environ.get("ODM_LOCAL_TTS_TOKEN", "")
SAMPLE_RATE = 24000
SPEAKERS = {"aidar", "baya", "kseniya", "xenia", "eugene"}
MODEL = None
MODEL_LOCK = Lock()

torch.set_num_threads(min(4, os.cpu_count() or 1))


def load_model():
    global MODEL
    if MODEL is None:
        if not torch.cuda.is_available():
            raise RuntimeError("ROCm cannot access the RX 9070 from this WSL process.")
        if not MODEL_PATH.is_file():
            raise RuntimeError("Russian Silero voice model is missing; run scripts/setup-local-tts.sh.")
        MODEL = PackageImporter(str(MODEL_PATH)).load_pickle("tts_models", "model")
        MODEL.to(torch.device("cuda"))
    return MODEL


def synthesize(segments):
    if not isinstance(segments, list) or not 1 <= len(segments) <= 24:
        raise ValueError("Provide 1 to 24 voice segments.")
    if sum(len(item.get("text", "")) for item in segments if isinstance(item, dict)) > 3000:
        raise ValueError("Narration text is too long.")

    chunks = []
    model = load_model()
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise ValueError("Each segment needs a speaker and text.")
        speaker = segment.get("speaker")
        text = segment.get("text")
        if speaker not in SPEAKERS or not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Each segment needs a supported speaker and 1 to 2000 characters.")
        audio = model.apply_tts(text=text, speaker=speaker, sample_rate=SAMPLE_RATE)
        samples = audio.detach().cpu().numpy()
        chunks.append(np.clip(samples, -1, 1))
        if index < len(segments) - 1:
            chunks.append(np.zeros(int(SAMPLE_RATE * 0.24), dtype=np.float32))

    pcm = (np.concatenate(chunks) * 32767).astype("<i2", copy=False).tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        supplied = self.headers.get("Authorization", "")
        return bool(TOKEN) and supplied.startswith("Bearer ") and hmac.compare_digest(supplied[7:].strip(), TOKEN)

    def do_GET(self):
        if self.path != "/healthz":
            self.send_error(404)
            return
        if not self.authorized():
            self.send_error(401)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"model":"silero-v5_5_ru","device":"cpu"}')

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        if not self.authorized():
            self.send_error(401)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 256_000:
                raise ValueError("Request body is empty or too large.")
            request = json.loads(self.rfile.read(length))
            # ponytail: one narrator speaks at a time; per-GPU model instances only if concurrent tables need it.
            with MODEL_LOCK:
                audio = synthesize(request.get("segments"))
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:
            message = str(error) if isinstance(error, ValueError) else "Local voice generation failed."
            body = json.dumps({"error": message}).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


if __name__ == "__main__":
    load_model()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
