#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_TAG:?Set RELEASE_TAG.}"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY.}"
: "${GH_TOKEN:?Set GH_TOKEN.}"
: "${BOAT_TEMPLATE_API_KEY:?Set BOAT_TEMPLATE_API_KEY.}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN.}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID.}"

if [[ ! $RELEASE_TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "The hosted release needs a stable v<version> tag." >&2
  exit 1
fi
version=${RELEASE_TAG#v}
name="openbot-server-production-${version//./-}"
asset="OpenBot-$version-x86_64.AppImage"

require_latest() {
  local latest
  latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
  if [ "$latest" != "$RELEASE_TAG" ]; then
    echo "The release is no longer the latest stable release. The production template was not changed." >&2
    exit 1
  fi
}
require_latest

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" \
  --pattern SHA256SUMS-linux.txt --dir "$work"
sha=$(awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1 }' "$work/SHA256SUMS-linux.txt")
if [[ ! $sha =~ ^[0-9a-f]{64}$ ]]; then
  echo "The release must have exactly one SHA-256 for the Linux x64 AppImage." >&2
  exit 1
fi

in_use=$(node_modules/.bin/wrangler d1 execute DB --remote --json --config apps/auth-api/wrangler.jsonc \
  --command "SELECT DISTINCT provider_template FROM hosted_servers
    WHERE provider_sandbox_id IS NULL AND provider_template IS NOT NULL AND observed_state != 'deleted'" |
  jq -er '[.[].results[].provider_template] | join(",")')

bun scripts/hosting/build-boat-template.ts \
  "--version=$version" \
  "--name=$name" \
  --keep-releases=3 \
  "--in-use=$in_use" \
  "--appimage-url=https://github.com/$GITHUB_REPOSITORY/releases/download/$RELEASE_TAG/$asset" \
  "--appimage-sha256=$sha" \
  --auth-api-url=https://api.openbot.run

require_latest
printf '%s\n' "$name" | node_modules/.bin/wrangler secret put HOSTED_SERVER_TEMPLATE \
  --config apps/auth-api/wrangler.jsonc
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf 'New production instances use `%s` from `%s`.\n' "$name" "$RELEASE_TAG" >> "$GITHUB_STEP_SUMMARY"
fi
