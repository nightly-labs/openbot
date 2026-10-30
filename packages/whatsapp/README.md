# @openbot/whatsapp

The WhatsApp client of the WhatsApp connector: a fork of Baileys without its copyleft parts, OpenBot's
own Signal-protocol code, and the encrypted store of one linked device. The connector itself
(`src/backend/messaging/whatsapp/`) uses this package; see [docs/messaging.md](../../docs/messaging.md).

| Path | What it is | License |
| --- | --- | --- |
| `vendor/baileys/` | Baileys v7.0.0-rc14, with the patches in `vendor/baileys/OPENBOT-PATCHES.md` | MIT (`vendor/baileys/LICENSE`) |
| `vendor/baileys/types/` | Declarations of the vendor, made by `bun run vendor:types` | MIT |
| `src/signal/`, `src/signal-repository.ts` | Signal sessions and sender keys, clean-room | PolyForm Noncommercial 1.0.0 |
| `src/auth-store.ts` | The device's encrypted SQLite store | PolyForm Noncommercial 1.0.0 |
| `docs/signal-protocol-notes.md` | The protocol facts that the Signal code is written from | PolyForm Noncommercial 1.0.0 |
| `test-vectors/` | Known-answer data for `scripts/whatsapp-signal-e2e.ts` | Data |

## Why a fork

Upstream Baileys imports `libsignal` (GPL-3.0) for Signal sessions and sender keys, and
`whatsapp-rust-bridge`, whose WebAssembly build contains `wacore-libsignal` (files marked
`AGPL-3.0-only`). OpenBot is PolyForm Noncommercial 1.0.0 and cannot ship either. The fork removes
both and gets its Signal code from `src/signal/`. Every other dependency is MIT, BSD-3-Clause,
Apache-2.0, ISC or BlueOak-1.0.0.

## Clean-room rules for `src/signal/`

The Signal code is a new implementation. Two separate people (or agent sessions) write it:

1. The **spec author** writes `docs/signal-protocol-notes.md`: facts only (formats, constants, field
   numbers, limits, algorithm steps in their own words), each with its source. The sources are
   Signal's public-domain specifications (X3DH, Double Ratchet, XEdDSA, Sesame), RFC 5869 and RFC 7748,
   the WhatsApp encryption white paper, the MIT Baileys files, and, for interop facts that no
   specification states, existing implementations (marked `[IMPL-FACT]`). The notes hold no code. The
   spec author also makes `test-vectors/` by running an existing implementation as a black box.
2. The **implementer** writes `src/signal/` from the notes, the specifications and the vectors only.
   The implementer never reads `libsignal`, `libsignal-node`, `signalapp/libsignal`,
   `go.mau.fi/libsignal`, `wacore-libsignal`, `@privacyresearch/*`, or the Baileys files that the fork
   removed.

Keep to these rules for each change of `src/signal/`. A change that needs a new fact goes through the
notes first. This is not legal advice: get a legal review before a release that changes this code.

## Checks

- `bun run --cwd packages/whatsapp typecheck`: this package under the repository's options, and the
  vendor under its own (`vendor/tsconfig.json`). The repository's type checks read the vendor only
  through `vendor/baileys/types/`.
- `bun scripts/whatsapp-signal-e2e.ts`: the vectors, conversations between in-process parties, and,
  when the black-box oracle of the spec author is in `/tmp/wa-oracle`, conversations with it.
- `bun scripts/messaging-whatsapp-e2e.ts`: the connector against a fake WhatsApp socket.

Only a live test with real phones proves that the Signal code works with WhatsApp. Run one before a
release that changes `src/signal/` or updates the vendor.

## Update Baileys

Follow `vendor/baileys/OPENBOT-PATCHES.md`. Then run `bun run --cwd packages/whatsapp vendor:types`
and the checks above.
