#!/usr/bin/env bash
# Renders the generated test labels in label.html to public/samples/labels/*.jpg.
# Requires Google Chrome (headless) and macOS `sips` for the JPEG conversion.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../public/samples/labels"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for variant in old-tom-bourbon old-tom-title-case-warning old-tom-reworded-warning old-tom-glare-angle stones-throw-gin; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,1500 \
    --screenshot="$tmp/$variant.png" "file://$here/label.html?variant=$variant" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 85 "$tmp/$variant.png" --out "$out/$variant.jpg" >/dev/null
  echo "rendered $variant.jpg"
done
