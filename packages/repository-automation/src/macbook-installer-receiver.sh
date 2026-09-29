#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo 'usage: receiver <directory> <installer-name> <sha256> <size>' >&2
  exit 2
fi

directory="$1"
name="$2"
expected_sha="$3"
expected_size="$4"
installer_pattern='^codex-buddy-[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?-macos-(arm64|x64)\.dmg$'

if [[ "$directory" != /* || ! "$name" =~ $installer_pattern || "$name" != *-macos-arm64.dmg ||
      ! "$expected_sha" =~ ^[a-f0-9]{64}$ || ! "$expected_size" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Invalid installer destination or metadata' >&2
  exit 2
fi
if [[ "$(uname -sm)" != 'Darwin arm64' ]]; then
  echo 'MacBook delivery requires an Apple Silicon Mac' >&2
  exit 1
fi

mkdir -p "$directory"
lock="$directory/.codex-buddy-delivery.lock"
if ! mkdir "$lock"; then
  echo 'Cannot access Downloads or another Codex Buddy delivery is running' >&2
  exit 1
fi
temporary=''
cleanup() {
  if [[ -n "$temporary" ]]; then rm -f -- "$temporary"; fi
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

temporary="$(mktemp "$directory/.codex-buddy.XXXXXX")"
cat > "$temporary"
actual_size="$(wc -c < "$temporary" | tr -d '[:space:]')"
actual_sha="$(shasum -a 256 "$temporary")"
actual_sha="${actual_sha%% *}"
if [[ "$actual_size" != "$expected_size" || "$actual_sha" != "$expected_sha" ]]; then
  echo 'Installer transfer failed size or SHA-256 verification; previous installers preserved' >&2
  exit 1
fi
destination="$directory/$name"
if [[ -L "$destination" || -d "$destination" ]]; then
  echo 'Installer destination is occupied by a link or directory' >&2
  exit 1
fi
chmod 644 "$temporary"
mv -f -- "$temporary" "$destination"
temporary=''

# 仅在新安装包完整落盘后清理同产品的旧 DMG，保留其他下载、目录和符号链接。
for candidate in "$directory"/codex-buddy-*-macos-*.dmg; do
  if [[ ! -f "$candidate" || -L "$candidate" || "$candidate" == "$destination" ]]; then
    continue
  fi
  if [[ "${candidate##*/}" =~ $installer_pattern ]]; then
    rm -- "$candidate"
  fi
done
printf '%s\n' "$destination"
