#!/usr/bin/env bash
set -euo pipefail

project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
godot_binary="$project_dir/Godot_v4.7.2-stable_linux.x86_64"

if [[ ! -x "$godot_binary" ]]; then
  printf 'Die Godot-Executable fehlt oder ist nicht ausführbar: %s\n' "$godot_binary" >&2
  exit 1
fi

exec "$godot_binary" --path "$project_dir/godot" "$@"
