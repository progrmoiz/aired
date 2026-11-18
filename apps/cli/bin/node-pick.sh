#!/usr/bin/env bash
# Find a Node >= 20 even when an older Node comes first on PATH (some shells list every
# nvm version, oldest first). Prints the path to use.
ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ] 2>/dev/null; }
for n in "${CLI_NODE:-}" "$(command -v node 2>/dev/null)"; do
  if [ -n "$n" ] && ok "$n"; then echo "$n"; exit 0; fi
done
d="$(cat "$HOME/.nvm/alias/default" 2>/dev/null | tr -d 'v[:space:]')"
if [ -n "$d" ]; then
  for n in "$HOME/.nvm/versions/node/v$d/bin/node" $(ls -d "$HOME"/.nvm/versions/node/v"$d"*/bin/node 2>/dev/null); do
    if ok "$n"; then echo "$n"; exit 0; fi
  done
fi
for n in $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -t/ -k7 -V -r) /opt/homebrew/bin/node /usr/local/bin/node; do
  if ok "$n"; then echo "$n"; exit 0; fi
done
echo "node" ; exit 0
