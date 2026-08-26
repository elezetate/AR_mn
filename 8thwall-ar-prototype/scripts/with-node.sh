#!/bin/sh

set -eu

if [ "${NODE_BIN:-}" != "" ]; then
  exec "$NODE_BIN" "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$@"
fi

CODEX_NODE="/Users/elezetate/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ -x "$CODEX_NODE" ]; then
  exec "$CODEX_NODE" "$@"
fi

echo "No se encontro un runtime de Node. Define NODE_BIN o instala node." >&2
exit 1
