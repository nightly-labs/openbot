# OpenBot patches to Baileys

Upstream: <https://github.com/WhiskeySockets/Baileys>, tag `v7.0.0-rc14`, commit
`7e7b0757e3f9f3c7789fb1cfd2f241d5002a199a`. License: MIT (`LICENSE`, kept unchanged).

Copied: `src/` and `WAProto/` (without `WAProto/fix-imports.js`). Every changed line has an
`OPENBOT PATCH` comment.

## Why

Upstream Baileys imports `libsignal` (GPL-3.0) for Signal sessions and sender keys, and
`whatsapp-rust-bridge`, whose WebAssembly build contains `wacore-libsignal` (files marked
`AGPL-3.0-only`). OpenBot is PolyForm Noncommercial 1.0.0 and cannot ship either. The patches remove
both and plug in OpenBot's clean-room Signal module (`../../src/signal`, see `../../README.md`).

## Removed

- `src/Signal/libsignal.ts`: the libsignal repository. OpenBot passes its own `makeSignalRepository`.
- `src/Signal/Group/*`: the sender key code, which imported `libsignal/src/crypto` and
  `libsignal/src/curve`. Its origin could not be confirmed, so it is not kept.
- `src/__tests__/`: upstream Jest tests.

## Changed

| File | Change |
| --- | --- |
| `src/Utils/crypto.ts` | `Curve` uses `src/signal/curve.ts`. `md5` and `hkdf` use `node:crypto` (synchronous, as the bridge was). |
| `src/Utils/lt-hash.ts` | The JavaScript LT-hash of Baileys 6.7.24 (MIT), synchronous, `subtractThenAdd(base, subtract, add)`. |
| `src/Utils/chat-utils.ts` | `mutationKeys` is the HKDF expansion of Baileys 6.7.24 (`WhatsApp Mutation Keys`, 160 bytes). |
| `src/Defaults/index.ts` | No `makeSignalRepository` default; `DEFAULT_CONNECTION_CONFIG` omits it. |
| `src/Types/index.ts` | `UserFacingSocketConfig` requires `makeSignalRepository`. |
| `src/index.ts` | Exports `Signal/lid-mapping` (`LIDMappingStore`). |
| `src/Utils/messages-media.ts` | `Crypto.Decipheriv` in place of `Crypto.Decipher`, which `@types/node` 24 removed. |
| `src/Types/optional-modules.d.ts` | New: declares the optional `link-preview-js`, which OpenBot does not install. |

## Updating from upstream

1. Download the new tag into an empty folder outside the repository.
2. Replace `src/` and `WAProto/`, then delete `src/Signal/libsignal.ts`, `src/Signal/Group/`,
   `src/__tests__/` and `WAProto/fix-imports.js`.
3. Apply each change in the table again. `grep -rn "libsignal\|whatsapp-rust-bridge" src` must find
   only `OPENBOT PATCH` comments.
4. Compare upstream's dependency list with `packages/whatsapp/package.json`, and check the license
   of each new package.
5. Check that `Types/Signal.ts` (`SignalRepository`) did not change. If it did, update
   `src/signal-repository.ts`.
6. Run `bun run --cwd packages/whatsapp vendor:types`, `bun run --cwd packages/whatsapp typecheck`
   and `bun scripts/whatsapp-signal-e2e.ts`.
7. Update the tag and commit at the top of this file.
