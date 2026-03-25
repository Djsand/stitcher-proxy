#!/bin/bash
# NeverForget — ensure proxy is running on session start

PORT="${NEVERFORGET_PORT:-8081}"

# Check if proxy is already running
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  STATS=$(curl -sf "http://localhost:${PORT}/v1/stitcher/stats" 2>/dev/null)
  SESSIONS=$(echo "$STATS" | grep -o '"session_count":[0-9]*' | cut -d: -f2)
  MSGS=$(echo "$STATS" | grep -o '"total_messages_stored":[0-9]*' | cut -d: -f2)
  echo "🧠 NeverForget active — ${SESSIONS:-0} sessions, ${MSGS:-0} messages in memory."
  exit 0
fi

# Not running — try to start
if ! command -v neverforget > /dev/null 2>&1; then
  echo "⚠️ NeverForget not installed. Run: npm i -g neverforget"
  exit 0
fi

# Start in background, suppress output
nohup neverforget start > /dev/null 2>&1 &
disown

# Wait for it to come up
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    echo "🧠 NeverForget started on port ${PORT}."
    exit 0
  fi
done

echo "⚠️ NeverForget failed to start. Run 'neverforget start' manually."
