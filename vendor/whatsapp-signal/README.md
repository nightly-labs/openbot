# whatsapp-signal

The WhatsApp account connector uses Baileys (`@whiskeysockets/baileys`, MIT). Baileys depends on
`libsignal` (`libsignal-node`), which is GPL-3.0. OpenBot is PolyForm Noncommercial 1.0.0 and must
not ship GPL code, so the root `package.json` replaces `libsignal` with this package through
`overrides`. The GPL package is never installed.

Its name is `libsignal` and its version 6.0.0, so that Baileys' dependency range `^6.0.0` matches
it in every tool. Its license is OpenBot's.

This package implements only the part of the `libsignal` API that Baileys imports:

- `libsignal`: `ProtocolAddress`, `SessionRecord`, `SessionCipher`, `SessionBuilder`.
- `libsignal/src/curve.js`: `generateKeyPair`, `calculateAgreement`, `calculateSignature`,
  `verifySignature`.
- `libsignal/src/crypto.js`: `encrypt`, `decrypt`, `calculateMAC`, `deriveSecrets`.
- `libsignal/src/protobufs.js`: `PreKeyWhisperMessage`.

The Signal protocol itself (X3DH, the Double Ratchet, XEdDSA) comes from `whatsapp-rust-bridge`
(MIT), which already ships with Baileys. The symmetric functions use `node:crypto`. Nothing here is
copied from `libsignal-node`.

`bun run test:whatsapp-signal` (`scripts/whatsapp-signal-e2e.ts`) checks sessions in both
directions, a changed message that must be refused, messages that `libsignal-node` encrypted
(recorded bytes, no `libsignal-node` code), and the curve, HKDF, AES and HMAC functions. It was also
checked against a real WhatsApp account: history and new messages decrypted with no failures.

Baileys works on replacing `libsignal` with `whatsapp-rust-bridge` itself
(WhiskeySockets/Baileys#2067). When a Baileys release does that, remove this package and the
override.
