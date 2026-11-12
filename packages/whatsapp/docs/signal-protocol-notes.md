# Signal protocol notes for WhatsApp multi-device interop

Status: facts for a clean-room implementation of the pairwise session (`pkmsg` / `msg`) and group
sender key (`skmsg`, SenderKeyDistributionMessage) layers that Baileys needs. This file contains
facts, constants, formats and algorithm steps in prose. It contains no code from any
implementation.

Known-answer vectors are in `../test-vectors/`. Each vector file says which facts it exercises.
Every byte-level fact below that has the mark **(vector)** was confirmed: an independent
recomputation from these notes gave the same bytes as the reference implementation.

## Source tags

| Tag | Source |
| --- | --- |
| [SPEC-X3DH] | signal.org/docs/specifications/x3dh (public domain) |
| [SPEC-DR] | signal.org/docs/specifications/doubleratchet (public domain) |
| [SPEC-XEDDSA] | signal.org/docs/specifications/xeddsa (public domain) |
| [SPEC-SESAME] | signal.org/docs/specifications/sesame (public domain) |
| [WA-WP] | WhatsApp Encryption Overview (technical white paper). Cited from memory; the PDF text was not machine-checked in this work. |
| [RFC5869] | HKDF |
| [RFC7748] | X25519 |
| [BAILEYS-MIT:path] | File under `packages/whatsapp/vendor/baileys/` (MIT) |
| [BAILEYS-MIT-UPSTREAM:path] | File in the published `baileys@7.0.0-rc14` npm package (MIT) that our fork deleted (`lib/Signal/libsignal.js`, `lib/Signal/Group/*`) |
| [IMPL-FACT] | Interop fact found only by reading or running an existing implementation (libsignal-node 6.0.0, libsignal-protocol-java, signalapp/libsignal Rust) |

"Unconfirmed" marks a fact that was not checked against a source in this work.

## 1. Primitives

1. Diffie-Hellman is X25519 [RFC7748]. Output is the raw 32-byte shared value. It is used as KDF
   input directly, without a hash [SPEC-X3DH] **(vector: x25519.json)**.
2. Private keys are 32 bytes. Stored private keys can be unclamped: libsignal-node keeps the raw
   32 random bytes from the platform key generator [IMPL-FACT]. Clamp at the point of use, for both
   X25519 and signing: clear the low 3 bits of byte 0, clear bit 7 of byte 31, set bit 6 of byte 31
   [RFC7748] **(vector: x25519.json "unclamped" sample)**.
3. When you decode a public key u-coordinate, ignore bit 7 of byte 31 [RFC7748].
4. HKDF is HKDF-SHA256 [RFC5869]. Every Signal use in this document gives a 32-byte salt
   (either 32 zero bytes or a root key) and an ASCII info string with no terminator. Output
   lengths: 64, 80 or 48 bytes. libsignal-node computes 96 bytes and keeps a prefix; HKDF output
   of length L is the prefix of any longer output, so a standard HKDF with the stated L gives the
   same bytes [RFC5869] **(vector)**.
5. MAC and chain derivations use HMAC-SHA256 with a full 32-byte output unless truncation is stated.
6. Message encryption is AES-256-CBC with PKCS#7 padding. A plaintext whose length is a multiple
   of 16 gets one full padding block (16 bytes of value 0x10). An empty plaintext gives 16 bytes of
   ciphertext [IMPL-FACT] **(vector: session-pkmsg.json step 2, 16-byte plaintext gives 32 bytes)**.
7. All protobuf integers in these messages are `uint32`, encoded as base-128 varints (low group
   first). Byte strings are length-delimited (varint length). Multi-byte integers outside protobuf
   (WhatsApp stanza fields) are big-endian (see section 4).

## 2. Public key encodings

| Where | Form |
| --- | --- |
| Inside every Signal protobuf: ratchet key, base key, identity key (PreKeySignalMessage), signing key (SenderKeyDistributionMessage) | 33 bytes: type byte 0x05, then the 32-byte X25519 u-coordinate [IMPL-FACT] **(vector)** |
| MAC input of a SignalMessage (both identity keys) | 33 bytes with 0x05 [IMPL-FACT] **(vector: `derived.message0.macInput`)** |
| Message signed by a signed-prekey signature | 33 bytes with 0x05 (the signed prekey public key) [BAILEYS-MIT:src/Utils/crypto.ts] |
| WhatsApp stanza prekey upload and prekey fetch nodes (`identity`, `skey/value`, `key/value`) | 32 bytes, no prefix. A separate `type` node holds the single byte 0x05 [BAILEYS-MIT:src/Utils/signal.ts] |
| Baileys credential store (`signedIdentityKey`, `signedPreKey.keyPair`, `pre-key` entries) | 32-byte public keys [BAILEYS-MIT:src/Utils/crypto.ts] |
| Retry-receipt key bundle | 32-byte keys; `type` node must be exactly 0x05 [BAILEYS-MIT:src/Utils/signal.ts] |

Baileys adds the 0x05 prefix to a 32-byte key and keeps a 33-byte key as is
[BAILEYS-MIT:src/Utils/crypto.ts `generateSignalPubKey`]. libsignal-node accepts a 33-byte key only
if byte 0 is 0x05; it also accepts a bare 32-byte key with a warning [IMPL-FACT]. Recommendation:
on the wire, require 33 bytes with 0x05; at internal APIs accept both forms.

## 3. Signatures

1. Scheme: Curve25519 signatures that are compatible with XEdDSA [SPEC-XEDDSA]. The signer key is
   an X25519 key pair. A signature is 64 bytes: R (32 bytes) then s (32 bytes) [SPEC-XEDDSA]
   **(vector: signatures.json)**.
2. Verification rule used by libsignal-node and Rust libsignal (Java unconfirmed) [IMPL-FACT]
   **(vector: signatures.json, checked with a standard Ed25519 verifier)**:
   1. Convert the Montgomery u-coordinate to the Edwards y-coordinate: y = (u − 1) / (u + 1) mod p,
      p = 2^255 − 19 [SPEC-XEDDSA].
   2. Take the Edwards sign bit from bit 7 of signature byte 63. Put it into bit 7 of byte 31 of the
      encoded Edwards point. Clear bit 7 of signature byte 63.
   3. Verify (R, s) as a standard Ed25519 signature over the message with that Edwards public key
      (h = SHA-512(R ‖ A ‖ message) mod ℓ; check s·B = R + h·A).
   4. The Rust implementation also rejects the signature if any of bits 5–7 of byte 63 are set after
      step 2 (that is, s ≥ 2^253) [IMPL-FACT]. XEdDSA has the same rule [SPEC-XEDDSA]. Apply it.
3. The sign bit in byte 63 matters. libsignal-node and the Rust implementation do not negate the
   private scalar; they put the sign bit of the real Edwards public key into byte 63
   [IMPL-FACT] **(vector: signatures.json has signatures with bit 7 set and clear)**. A strict
   XEdDSA verifier that always assumes sign bit 0 rejects about half of these signatures. Do not
   use one.
4. Signing in libsignal-node is deterministic. Nonce r = SHA-512(clamped private scalar as 32
   little-endian bytes ‖ message) mod ℓ. A = clamped scalar × base point, with its real sign bit.
   s = r + SHA-512(R ‖ A ‖ message)·a mod ℓ. Byte 63 then gets the sign bit of A [IMPL-FACT].
   The Rust implementation randomizes the nonce: SHA-512 over the XEdDSA domain prefix (byte
   0xFE, then 31 bytes 0xFF), the scalar, the message and 64 random bytes [IMPL-FACT]. Java
   unconfirmed.
5. Interop needs only valid signatures; the nonce rule is not visible to a verifier
   **(vector: signatures.json "NOT produced by libsignal" entry, accepted)**. A safe signer
   choice is XEdDSA as specified [SPEC-XEDDSA]: negate the scalar when the sign bit of A is 1, so
   the sign bit is always 0 and byte 63 bit 7 is clear. Those signatures pass both the sign-bit rule
   above and a strict XEdDSA verifier. (Reasoning from the specs; not tested against a WhatsApp
   client.)
6. What is signed:
   - Signed prekey: the 33-byte (0x05-prefixed) signed prekey public key, signed with the identity
     private key [BAILEYS-MIT:src/Utils/crypto.ts `signedKeyPair`] [SPEC-X3DH].
   - SenderKeyMessage: the version byte and the protobuf bytes (everything except the trailing
     64-byte signature), signed with the sender key signing private key (section 9)
     [IMPL-FACT] [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/sender-key-message.js] **(vector)**.
   - Baileys uses the same primitive for ADV device identity signatures and noise certificate
     checks [BAILEYS-MIT:src/Utils/validate-connection.ts, src/Utils/noise-handler.ts]. Those
     callers still import the curve module from `libsignal/src/curve` in
     [BAILEYS-MIT:src/Utils/crypto.ts], so the replacement must also provide key generation,
     agreement, sign and verify.
7. libsignal-node rejects a signature that is not exactly 64 bytes and rejects signing an empty
   message [IMPL-FACT].

## 4. Identity, registration ID and prekeys

1. Identity key: one long-term X25519 key pair per device (Baileys `signedIdentityKey`)
   [BAILEYS-MIT:src/Utils/auth-utils.ts] [SPEC-X3DH].
2. Registration ID: random 14-bit value, 0..16383 in Baileys (two random bytes AND 0x3FFF)
   [BAILEYS-MIT:src/Utils/generics.ts]. It goes in the stanza `registration` node as 4 bytes
   big-endian [BAILEYS-MIT:src/Utils/signal.ts] and in PreKeySignalMessage field 5. A receiver
   stores the remote registration ID in the session state. Baileys compares it with the ID in a
   retry receipt to detect a reinstalled peer [BAILEYS-MIT:src/Socket/messages-recv.ts].
3. Signed prekey: X25519 key pair, an ID, and the signature from section 3. Baileys creates ID 1
   and adds 1 for each rotation [BAILEYS-MIT:src/Utils/auth-utils.ts, src/Socket/socket.ts].
   Stanza IDs are 3 bytes big-endian, so the maximum ID is 2^24 − 1 [BAILEYS-MIT:src/Utils/signal.ts].
   Upstream Baileys returns the current signed prekey for every requested ID
   [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js]. Recommendation: keep previous signed prekeys
   by ID for some time after rotation; a `pkmsg` that names an old ID otherwise fails.
4. One-time prekeys: X25519 key pairs with IDs. Baileys starts at 1
   [BAILEYS-MIT:src/Utils/auth-utils.ts]. **Do not use ID 0**: libsignal-node treats a prekey ID of 0
   as "no one-time prekey" on both the sending and the receiving side [IMPL-FACT]. The receiver
   deletes the one-time prekey after the `pkmsg` that uses it decrypts [IMPL-FACT] [SPEC-X3DH].
5. A fetched bundle per device has: registration ID, identity key, signed prekey (ID, key,
   signature), optional one-time prekey (ID, key) [BAILEYS-MIT:src/Utils/signal.ts].

## 5. Session setup

Names: Alice is the initiator; Bob owns the bundle. IK = identity key, SPK = signed prekey,
OPK = one-time prekey, EK = Alice's base key.

### Initiator (Alice)

1. Optionally check the identity key trust (section 8).
2. The X3DH spec says Alice must verify the SPK signature [SPEC-X3DH]. libsignal-node does not
   verify it (it skips the check on this path) [IMPL-FACT]; libsignal-protocol-java verifies it
   (unconfirmed). See "Not determined".
3. Make a new base key pair EK. Make a second new key pair, the first sending ratchet key RA0.
   EK and RA0 are different key pairs [IMPL-FACT] **(vector: Alice draws the base key, then
   `ratchetKeysInOrder[0]`)**.
4. Master secret input, in this order [SPEC-X3DH] [WA-WP] **(vector: `derived.masterSecretInput`)**:
   - 32 bytes of 0xFF (the X3DH "F" prefix for X25519),
   - DH(IK_A private, SPK_B public),
   - DH(EK private, IK_B public),
   - DH(EK private, SPK_B public),
   - DH(EK private, OPK_B public), only if the bundle has a one-time prekey.
   Total 128 bytes without OPK, 160 bytes with OPK.
5. HKDF: input = master secret input, salt = 32 zero bytes, info = `WhisperText`, length 64.
   Bytes 0–31 are root key RK0. Bytes 32–63 are a chain key that neither side uses for messages
   in practice [IMPL-FACT] **(vector: `hkdfWhisperText_rootKey`, `..._chainKey_unused`)**.
6. Sending chain: one root-KDF step (section 6) with DH(RA0 private, SPK_B public) and RK0. The
   result is the new root key and Alice's first sending chain key **(vector)**.
7. Session state: remote identity key IK_B; remote registration ID from the bundle; the "last
   remote ratchet key" is SPK_B; previous counter 0; base key = EK public (33 bytes); pending
   prekey data = {signed prekey ID, one-time prekey ID if any, EK public} [IMPL-FACT].

### Responder (Bob), on a `pkmsg`

1. Parse the PreKeySignalMessage (section 7). Optionally check trust of `identityKey`.
2. If the record already has a state whose base key equals the message `baseKey`, use that state.
   Do not build a new one. (Alice sends `pkmsg` until she gets a reply.) [IMPL-FACT]
3. Else: load the signed prekey by `signedPreKeyId` (error if missing). If `preKeyId` is present,
   load that one-time prekey (error if missing). Compute the same master secret with roles
   mirrored: DH(SPK_B, IK_A), DH(IK_B, EK), DH(SPK_B, EK), and DH(OPK_B, EK) if a one-time prekey
   was used. Keep the order of the list in the initiator steps [SPEC-X3DH] [IMPL-FACT].
4. HKDF as in initiator step 5 gives RK0.
5. Session state: our current ratchet key pair = the SPK_B key pair; no sending chain yet;
   remote identity = `identityKey`; remote registration ID = `registrationId`; base key = `baseKey`;
   previous counter 0 [IMPL-FACT].
6. Decrypt the inner SignalMessage. Its ratchet key (RA0) is new, so this causes a DH ratchet step
   (section 6): the receiving chain comes from DH(SPK_B, RA0) and RK0 (it equals Alice's first
   sending chain), then Bob makes a new ratchet key and his first sending chain
   **(vector: Bob draws one key on the first `pkmsg`)**.
7. Archive the previous current state (if any) and make the new state current (section 8). Delete
   the one-time prekey only after the decryption succeeds [IMPL-FACT].

"Base key" is Alice's EK public key. It identifies a session state between two devices
[IMPL-FACT]. Baileys reads the current state base key for retry handling
[BAILEYS-MIT:src/Socket/messages-recv.ts, src/Utils/message-retry-manager.ts].

## 6. Double Ratchet details

1. Root KDF: HKDF with input = 32-byte DH output, salt = current root key, info = `WhisperRatchet`,
   length 64. Bytes 0–31 = new root key, bytes 32–63 = new chain key [SPEC-DR] (structure)
   [IMPL-FACT] (info string) **(vector)**.
2. Chain KDF: message key seed = HMAC-SHA256(key = chain key, data = one byte 0x01). Next chain key
   = HMAC-SHA256(key = chain key, data = one byte 0x02) [SPEC-DR] [WA-WP] **(vector)**.
3. Message keys: HKDF with input = message key seed, salt = 32 zero bytes, info =
   `WhisperMessageKeys`, length 80. Bytes 0–31 = AES-256 key, 32–63 = HMAC-SHA256 key, 64–79 = IV
   [WA-WP] (80-byte split) [IMPL-FACT] (info string) **(vector: `derived.message0`)**.
4. Counters: the first message of each chain has counter 0. Each message on the chain adds 1
   [IMPL-FACT] **(vector)**.
5. Previous counter (PN): when a party makes a new sending chain, PN is set to the **counter of the
   last message it sent on the old sending chain** (number of messages − 1). This is different from
   the DR spec, where PN is the number of messages [IMPL-FACT] **(vector: session-out-of-order.json
   step 10 has previousCounter 2 after three messages)**. Java uses the larger of (count − 1) and 0
   [IMPL-FACT]. The initial PN is 0. A receiver derives and keeps keys of the old chain up to and
   including index PN.
6. Sending: take the current sending chain, derive the next message key, increase the counter, and
   build the header: ratchet key = our current ratchet public key (33 bytes), counter, previous
   counter = PN. The used message key is deleted.
7. Receiving, when the message ratchet key is not known in the state (DH ratchet step)
   [SPEC-DR] [IMPL-FACT]:
   1. If a receiving chain exists for the last remote ratchet key, derive and keep its message
      keys up to index PN from the message header. Then close that chain (derive no more keys).
   2. New receiving chain: root KDF with DH(our current ratchet private key, message ratchet key).
   3. Remember the last counter of our current sending chain as the new PN, then drop that chain.
   4. Make a new ratchet key pair. New sending chain: root KDF with DH(new private key, message
      ratchet key).
   5. Store the message ratchet key as the last remote ratchet key.
8. Receiving on a known chain: if the counter is larger than the last derived index, derive
   forward and keep the skipped message keys. If the counter is smaller, use the kept key for that
   counter; if none is kept (already used, or never derived), fail [IMPL-FACT].
9. Forward limit: fail if (message counter − last derived index on that chain) > 2000. On a fresh
   chain the last derived index is −1, so the highest counter that can be accepted as the first
   message on a chain is 1999 [IMPL-FACT: libsignal-node, Java] **(vector: futureLimit in
   session-out-of-order.json; +2000 accepted, +2001 rejected)**. The Rust implementation allows
   25 000 [IMPL-FACT]. The same limit applies when filling the old chain up to PN.
10. Kept skipped keys: libsignal-node keeps all of them and never removes closed receiving chains
    [IMPL-FACT]. Java and Rust keep at most 2000 message keys per receiving chain (oldest removed)
    and at most 5 receiving chains (oldest removed) [IMPL-FACT]. These are local policy choices,
    not wire facts. Recommendation: 2000 keys per chain, 5 chains.
11. Order of checks on decrypt: compute the chain and message key, verify the MAC, then decrypt.
    Change the stored state only if every step succeeds. libsignal-node stores the record only
    after success [IMPL-FACT].
12. A successful decrypt on a state clears its pending prekey data (section 8.4) [IMPL-FACT].

## 7. Wire formats

### Version byte

The first byte of every serialized message is 0x33 [IMPL-FACT] **(vector)**. The high 4 bits are
the message version (3). The low 4 bits are also 3. libsignal-node rejects a message whose high
nibble is less than 3 or whose low nibble is greater than 3 [IMPL-FACT]. Upstream Baileys checks
that the low nibble is 3 before it reads the identity key from a `pkmsg`
[BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js]. Recommendation: always send 0x33; accept a
message only if both nibbles are 3.

### SignalMessage (`msg`; libsignal-node calls it WhisperMessage)

Protobuf fields [BAILEYS-MIT:WAProto/WAProto.proto `SignalMessage`]:

| Field | Number | Type | Content |
| --- | --- | --- | --- |
| ratchetKey | 1 | bytes | sender's current ratchet public key, 33 bytes |
| counter | 2 | uint32 | message index in the sending chain |
| previousCounter | 3 | uint32 | PN (section 6.5) |
| ciphertext | 4 | bytes | AES-256-CBC output |

Serialized form: version byte (0x33) ‖ protobuf ‖ MAC (8 bytes) [IMPL-FACT] **(vector)**.

MAC = first 8 bytes of HMAC-SHA256(key = message MAC key, data = sender identity public key
(33 bytes) ‖ receiver identity public key (33 bytes) ‖ version byte ‖ protobuf bytes)
[IMPL-FACT] **(vector: `derived.message0.macInput`)**. "Sender" is the party that encrypted the
message. The receiver must compute the MAC over the protobuf bytes exactly as received (do not
re-encode). Compare in constant time.

To reproduce bytes exactly (needed only to match vectors): emit fields in the order 1, 2, 3, 4,
and emit counter and previousCounter even when they are 0 [IMPL-FACT] **(vector)**. A typical
message with a 32-byte ciphertext is 82 bytes.

### PreKeySignalMessage (`pkmsg`)

Protobuf fields [BAILEYS-MIT:WAProto/WAProto.proto `PreKeySignalMessage`]:

| Field | Number | Type | Content |
| --- | --- | --- | --- |
| preKeyId | 1 | uint32 | one-time prekey ID; omit the field when none was used |
| baseKey | 2 | bytes | EK public, 33 bytes |
| identityKey | 3 | bytes | sender identity public key, 33 bytes |
| message | 4 | bytes | the complete serialized SignalMessage (with its own version byte and MAC) |
| registrationId | 5 | uint32 | sender registration ID |
| signedPreKeyId | 6 | uint32 | signed prekey ID |

Serialized form: version byte (0x33) ‖ protobuf. There is no MAC or signature on the outer
message [IMPL-FACT] **(vector)**. libsignal-node emits the fields in the order 1, 2, 3, 4, 5, 6
[IMPL-FACT] **(vector)**.

### WhatsApp envelope

- The stanza child is `enc` with attributes `v="2"` and `type` = `pkmsg`, `msg` or `skmsg`. The node
  content is the serialized message [BAILEYS-MIT:src/Socket/messages-send.ts].
- The Signal plaintext is a serialized WhatsApp `Message` protobuf followed by 1–16 padding bytes,
  each byte equal to the padding length. Baileys adds it before Signal encryption and removes it
  after decryption [BAILEYS-MIT:src/Utils/generics.ts `writeRandomPadMax16`,
  src/Utils/decode-wa-message.ts]. This padding is separate from the AES PKCS#7 padding. The
  Signal layer must not add or remove it.
- libsignal numbers the message types 3 (prekey) and 1 or 2 (normal); only the `type` attribute
  string goes on the wire [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js].

## 8. Session records

1. One record per remote address (section 10). A record holds one current state and zero or more
   archived states [SPEC-SESAME] [IMPL-FACT].
2. New state from a bundle (initiator): archive the current state, the new state becomes current
   [IMPL-FACT].
3. New state from a `pkmsg` with an unknown base key: archive the current state, the new state
   becomes current. A `pkmsg` with a known base key uses the matching state, current or archived
   [IMPL-FACT].
4. Pending prekey: after an initiator builds a state, every message it encrypts on that state is a
   `pkmsg` with the same base key, identity key, registration ID, signed prekey ID and one-time
   prekey ID; only the inner SignalMessage changes. This stops after the first successful decrypt
   on that state [IMPL-FACT] **(vector: steps 1–2 are `pkmsg`, step 7 is `msg`)**.
5. Decrypting a `msg`: try the current state first, then the archived states. libsignal-node tries
   all states in order of last successful use and does not promote the one that worked
   [IMPL-FACT]. libsignal-protocol-java promotes the archived state that worked to current
   [IMPL-FACT]. Recommendation: try current, then archived from newest; promote on success.
6. Archive limit: libsignal-node keeps at most 40 states in total and removes the oldest archived
   one [IMPL-FACT]; libsignal-protocol-java keeps 40 archived states [IMPL-FACT]; current Rust
   libsignal keeps 3 [IMPL-FACT]. Recommendation: 40 (cheap, and more tolerant of message
   backlogs).
7. Each state stores: remote identity key (33 bytes), remote registration ID, base key, root key,
   current ratchet key pair, last remote ratchet key, PN, sending chain (key, counter), receiving
   chains (remote ratchet key, chain key, counter, kept message keys), pending prekey data
   [IMPL-FACT] [SPEC-DR].
8. Deleting the record forces the next send to start from a fresh bundle. Baileys deletes records
   on identity change, on some retry conditions, and on explicit session reset
   [BAILEYS-MIT:src/Socket/messages-recv.ts] [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js].

### Identity trust

- Upstream Baileys trusts every identity (trust on first use, "same as WhatsApp Web")
  [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js]. Before it decrypts a `pkmsg`, it reads
  `identityKey` (33 bytes) and compares it with the stored identity for that address. If no
  identity is stored, it stores this one. If a different one is stored, it deletes the session
  record for the address and stores the new identity. Then it decrypts (which builds a new state).
- Identity is stored per address string in the `identity-key` store
  [BAILEYS-MIT:src/Types/Auth.ts].
- A server notification with an `identity` child for a primary device (device 0) that has a
  session makes Baileys rebuild the session from a new bundle; companion devices are ignored
  [BAILEYS-MIT:src/Utils/identity-change-handler.ts].

## 9. Group sender keys

1. Own sender key state: key ID (uint32; upstream Baileys picks a random integer in
   0..2^31 − 2), chain key (32 random bytes), iteration 0, and a new X25519 signing key pair
   [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/keyhelper.js, group-session-builder.js] [WA-WP].
   Creating a new own sender key replaces the old one (the own record holds one state)
   [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/sender-key-record.js].
2. Chain: message key seed = HMAC-SHA256(key = chain key, data = 0x01); next chain key =
   HMAC-SHA256(key = chain key, data = 0x02); the iteration increases by 1 [WA-WP] [IMPL-FACT]
   **(vector: `derived` in sender-keys.json)**.
3. Message key: HKDF with input = message key seed, salt = 32 zero bytes, info = `WhisperGroup`,
   length 48. **Bytes 0–15 = IV, bytes 16–47 = AES-256 key.** The order is different from the
   pairwise split [IMPL-FACT] **(vector)**.
4. Cipher: AES-256-CBC with PKCS#7 [WA-WP] **(vector)**. No MAC; the signature protects the message.
5. SenderKeyMessage fields [BAILEYS-MIT:WAProto/WAProto.proto `SenderKeyMessage`]: 1 `id` uint32
   (key ID), 2 `iteration` uint32, 3 `ciphertext` bytes. Serialized: version byte 0x33 ‖ protobuf ‖
   signature (64 bytes). The signature covers version byte ‖ protobuf and uses the signing private
   key [IMPL-FACT] **(vector)**. Field order 1, 2, 3; `iteration` 0 is emitted [IMPL-FACT]
   **(vector: message 0 protobuf starts `08 .. 10 00 1a`)**.
6. SenderKeyDistributionMessage fields [BAILEYS-MIT:WAProto/WAProto.proto
   `SenderKeyDistributionMessage`]: 1 `id` uint32, 2 `iteration` uint32, 3 `chainKey` bytes (32),
   4 `signingKey` bytes (33, with 0x05). Serialized: version byte 0x33 ‖ protobuf, with no signature
   [IMPL-FACT] **(vector)**. The SKDM states the sender's current iteration and the chain key at
   that iteration, so a receiver seeded by it cannot decrypt older messages
   **(vector: `lateSkdm`, last delivery)**.
7. Transport: the SKDM travels inside a pairwise-encrypted WhatsApp `Message`, field 2
   `senderKeyDistributionMessage`, which has `groupId` (1, string, group JID) and
   `axolotlSenderKeyDistributionMessage` (2, bytes, the serialized SKDM)
   [BAILEYS-MIT:WAProto/WAProto.proto] [BAILEYS-MIT:src/Socket/messages-send.ts]. The sender sends
   it to each participant device that does not have the key yet (Baileys `sender-key-memory`),
   in the same stanza as the `skmsg` [BAILEYS-MIT:src/Socket/messages-send.ts]. A receiver
   processes it after it decrypts and unpads the pairwise message
   [BAILEYS-MIT:src/Utils/decode-wa-message.ts].
8. Processing an SKDM: add a receiving state with the key ID, iteration, chain key and signing
   public key (no private key). Keep at most 5 states per (group, sender); remove the oldest
   [IMPL-FACT: Java] [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/sender-key-record.js]. Upstream
   Baileys adds a new state even when one with the same key ID exists, and lookup returns the
   oldest match [BAILEYS-MIT-UPSTREAM]. Recommendation: if a state with the same key ID and signing
   key exists, keep it and ignore the duplicate SKDM.
9. Decrypting an `skmsg`: find the state by `id` (fail if none). Verify the signature with that
   state's signing key before anything else (fail if invalid) **(vector: tampered message)**. Then:
   - iteration below the current chain iteration: use the kept key for that iteration and delete
     it; fail if none **(vector: duplicate delivery fails)**;
   - iteration more than 2000 above the current chain iteration: fail [IMPL-FACT: Java,
     Baileys upstream];
   - otherwise derive forward, keep the skipped message keys (at most 2000 per state, oldest
     removed), use the key for this iteration, and set the chain to iteration + 1
     [IMPL-FACT] [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/group_cipher.js, sender-key-state.js]
     **(vector: jump from 2 to 18, then 8 and 4 from kept keys)**.
10. Encrypting: use the current chain iteration for the message key, then advance the chain by
    one (Java behaviour) [IMPL-FACT]. Upstream Baileys instead skips one iteration per message
    after the first (iterations 0, 2, 4, ...) **(vector)**. Receivers accept both. Use the
    sequential form.
11. In groups with LID addressing, Baileys uses its own LID as the sender identity for the sender
    key [BAILEYS-MIT:src/Socket/messages-send.ts].

## 10. Addresses (storage IDs)

1. A Signal protocol address is a name plus a device ID. Its string form is `<name>.<deviceId>`.
   The name must not contain `.` [IMPL-FACT]. This string is the key in the Baileys `session` and
   `identity-key` stores [BAILEYS-MIT:src/Socket/messages-recv.ts]
   [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js].
2. JID to address (upstream Baileys) [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js], using
   `jidDecode` [BAILEYS-MIT:src/WABinary/jid-utils.ts]:
   - name = JID user; if the domain type is not 0 (WhatsApp), name = `<user>_<domainType>`;
   - device ID = JID device, or 0 if none;
   - domain types: 0 = `s.whatsapp.net`, 1 = `lid`, 128 = `hosted`, 129 = `hosted.lid`. A
     `<user>_<n>` user part on another server also gives domain type n;
   - device 99 is valid only on `hosted` / `hosted.lid` servers; otherwise it is an error.

   | JID | Address |
   | --- | --- |
   | `15551234567@s.whatsapp.net` | `15551234567.0` |
   | `15551234567:3@s.whatsapp.net` | `15551234567.3` |
   | `123456789012345@lid` | `123456789012345_1.0` |
   | `123456789012345:2@lid` | `123456789012345_1.2` |
   | `15551234567:99@hosted` | `15551234567_128.99` |
   | `123456789012345:99@hosted.lid` | `123456789012345_129.99` |

3. Upstream Baileys resolves a phone-number address to the LID address when it knows the
   mapping, so sessions and identities are stored under the LID address; it moves existing PN
   sessions to LID addresses when it learns a mapping [BAILEYS-MIT-UPSTREAM:lib/Signal/libsignal.js]
   [BAILEYS-MIT:src/Utils/decode-wa-message.ts]. Decryption uses the LID JID when one is known
   [BAILEYS-MIT:src/Utils/decode-wa-message.ts `getDecryptionJid`].
4. Sender key storage name: `<group JID>::<sender address name>::<sender device ID>`, for example
   `120363000000000000@g.us::123456789012345_1::0` [BAILEYS-MIT-UPSTREAM:lib/Signal/Group/sender-key-name.js].

## 11. Easy mistakes

- Using 32-byte keys where 33-byte keys are required (MAC input, protobuf fields, signed prekey
  signature message), or the reverse in stanzas.
- Using the DR-spec PN (count) instead of the last index.
- Using one shared split for message keys: pairwise is key/MAC/IV (32/32/16); group is IV/key
  (16/32).
- Forgetting the 32 × 0xFF prefix, or the DH order, in the master secret input.
- Using the `WhisperText` chain key for messages (not used), or using the base key as the first
  ratchet key (they are different key pairs).
- Treating prekey ID 0 as a real ID.
- Re-encoding a parsed protobuf before the MAC check, or before the SenderKeyMessage signature
  check. Always use the received bytes.
- Verifying signatures without moving the sign bit from byte 63.
- Changing the stored state when a decrypt fails, or deleting a message key before the MAC check
  passes.
- Building a new state for a repeated `pkmsg` that has a known base key (this breaks the session
  that Alice still uses).
- Removing the WhatsApp 1–16 byte padding inside the Signal layer, or not removing it above it.
- Mixing WhatsApp stanza integer widths: registration ID 4 bytes big-endian, prekey IDs 3 bytes
  big-endian.

## 12. Not determined

- **Bundle signature check by WhatsApp-compatible clients.** libsignal-node (used by Baileys)
  never verifies the signed-prekey signature when it builds an outgoing session, so it is not
  known whether WhatsApp ever serves a bundle that fails verification. Verifying is safer;
  rejecting a bundle can cause send failures that Baileys does not have. Developer decision.
- **Limits used by official WhatsApp clients** (forward skip, kept keys, archived states, sender
  key states). Only libsignal-node, Java and Rust values are known (sections 6, 8, 9).
- **Version byte from official clients.** Only 0x33 was seen. Not checked whether WhatsApp ever
  sends another value.
- **Iteration pattern of official WhatsApp senders.** Not checked; receivers must accept gaps
  anyway.
- **WA-WP citations** come from memory of the white paper; its PDF text was not machine-checked.
  Every byte-level fact also has an [IMPL-FACT] source and most have a vector.
- **Java signing nonce details** (section 3.4) were not checked in this work.
- Storage formats of existing libsignal-node or Baileys session and sender key records are not
  described. OpenBot has no stored records in those formats. If an import is ever needed, the
  oracle (outside the repository) reads them.
