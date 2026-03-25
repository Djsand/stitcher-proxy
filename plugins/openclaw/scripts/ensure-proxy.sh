#!/bin/bash
PORT="${NEVERFORGET_PORT:-8081}"
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo "NeverForget proxy running on port ${PORT}"
  curl -sf "http://localhost:${PORT}/v1/stitcher/stats"
else
  if command -v neverforget > /dev/null 2>&1; then
    neverforget start > /dev/null 2>&1 &
    sleep 1
    echo "NeverForget started on port ${PORT}"
  else
    echo "NeverForget not installed. Run: npm i -g neverforget"
    exit 1
  fi
fi
