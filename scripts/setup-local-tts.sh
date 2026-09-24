#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CACHE="${ODM_LOCAL_TTS_CACHE:-$ROOT/node_modules/.cache/odm-tts}"
VENV="$CACHE/.venv"
MODEL="$CACHE/v5_5_ru.pt"
TORCH_WHEEL="https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2/torch-2.9.1%2Brocm7.2.0.lw.git7e1940d4-cp312-cp312-linux_x86_64.whl"
TRITON_WHEEL="https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2/triton-3.5.1%2Brocm7.2.0.gita272dfa8-cp312-cp312-linux_x86_64.whl"

command -v uv >/dev/null 2>&1 || { echo "Install uv first: https://docs.astral.sh/uv/" >&2; exit 1; }
command -v /usr/bin/python3.12 >/dev/null 2>&1 || { echo "AMD's ROCm wheel requires Python 3.12." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v rocminfo >/dev/null 2>&1 || { echo "ROCm for WSL is missing; install AMD's supported WSL GPU stack first." >&2; exit 1; }
if ! rocminfo | grep -q 'AMD Radeon RX 9070'; then
  echo "ROCm cannot see an RX 9070 in WSL; refusing to install a CPU-only build." >&2
  exit 1
fi

mkdir -p "$CACHE"
export UV_CACHE_DIR="$CACHE/.uv-cache"
uv venv --clear --python /usr/bin/python3.12 "$VENV"
uv pip install --python "$VENV/bin/python" "$TORCH_WHEEL" "$TRITON_WHEEL" numpy==1.26.4
if [ ! -s "$MODEL" ]; then
  curl --fail --location --retry 3 https://models.silero.ai/models/tts/ru/v5_5_ru.pt -o "$MODEL.tmp"
  mv "$MODEL.tmp" "$MODEL"
fi
env -u LD_LIBRARY_PATH ODM_LOCAL_TTS_MODEL_PATH="$MODEL" "$VENV/bin/python" -c 'import os, torch; from torch.package import PackageImporter; torch.set_num_threads(4); model=PackageImporter(os.environ["ODM_LOCAL_TTS_MODEL_PATH"]).load_pickle("tts_models", "model"); model.to("cuda"); audio=model.apply_tts(text="Проверка связи.", speaker="xenia", sample_rate=24000); torch.cuda.synchronize(); assert audio.numel(); print("GPU:", torch.cuda.get_device_name(0), "ROCm:", torch.version.hip, "voice sample:", round(audio.numel()/24000, 2), "seconds")'
uv cache clean
echo "Local Russian GPU TTS is ready (ROCm 7.2.0)."
echo "Python: $VENV/bin/python"
echo "Model: $MODEL"
