# Dependency security fixes

The root manifest and `bun.lock` include the security updates checked on 12 September 2026.
Keep the patch declarations in `package.json`; a frozen install must apply them in CI and releases.
Do not suppress the three version-based audit findings for these patched packages.

## Local patches

- `decode-uri-component@0.2.2`: backport the linear UTF-8 scanner from the MIT-licensed
  [0.5.0 source](https://github.com/SamVerschueren/decode-uri-component/blob/a12fabaa28303cc8b5b07e93d128f4fc09fc31e5/index.js).
  Keep the existing CommonJS export and `+` decoding for `query-string@7` callers.
  This addresses [CVE-2026-45822](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).
  Remove the patch when callers support a fixed release without a module-format change.
- `image-size@1.2.1`: reject ICNS entries shorter than their header or outside the input;
  reject image boxes shorter than eight bytes. This prevents non-advancing ICNS and JXL
  loops and rejects malformed HEIF boxes. There is no published fixed version for
  [CVE-2025-71330](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) or
  [CVE-2025-71329](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).
  Remove the patch when a compatible fixed release is available.

The scanner still reports these original package versions. Regression tests exercise the installed
patched code in child processes with deadlines, plus valid images and URI decoding.

## Overrides

- `sharp@0.35.4` replaces Miniflare's exact `0.35.2` pin to include the
  [libheif fixes](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
  Remove the override when Miniflare requires a fixed release.
- `uuid@11.1.1` replaces Xcode tooling's `7.x` requirement. Xcode uses the compatible
  CommonJS `v4()` API. The override avoids the buffer bounds advisory while preserving
  generated project identifiers. Remove it when Xcode tooling requires a fixed release.

Run `bun run test:desktop -- scripts/dependency-security.test.ts` for the patched parsers and
consumer checks, and `bun run test:desktop -- scripts/dependency-catalog.test.ts` for workspace
and deployment manifest coverage. Run the required full lint and typecheck as well.
