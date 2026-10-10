#!/bin/sh
set -eu

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:4b}"
export OLLAMA_MODEL

ollama serve > /tmp/ollama.log 2>&1 &
OLLAMA_PID=$!

cleanup() {
  kill "$OLLAMA_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

echo "Starting internal Ollama server."
attempt=0
while ! curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null; do
  if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "ERROR: Ollama exited before its API became ready." >&2
    tail -n 40 /tmp/ollama.log >&2 || true
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 180 ]; then
    echo "ERROR: Ollama API did not become ready within 6 minutes." >&2
    tail -n 40 /tmp/ollama.log >&2 || true
    exit 1
  fi
  sleep 2
done

if ! ollama list | awk -v model="$OLLAMA_MODEL" 'NR > 1 && $1 == model { found = 1 } END { exit !found }'; then
  echo "Model $OLLAMA_MODEL is not present; downloading it now."
  if ! ollama pull "$OLLAMA_MODEL"; then
    echo "ERROR: Unable to download required Ollama model $OLLAMA_MODEL." >&2
    exit 1
  fi
fi

if ! ollama list | awk -v model="$OLLAMA_MODEL" 'NR > 1 && $1 == model { found = 1 } END { exit !found }'; then
  echo "ERROR: Required Ollama model $OLLAMA_MODEL is unavailable after startup." >&2
  exit 1
fi

echo "Ollama and model $OLLAMA_MODEL are ready; starting the Roamly API."
node /app/server.js
