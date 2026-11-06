// Frozen optional codex-api-key-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. It
// tells a client that the host logs Codex in with an OpenAI API key sent through the released
// `apiKeySet` route of providers-v1, v5 or v8, as `codex login --with-api-key` does on that computer.
// Codex keeps the key in its own login, not in OpenBot's key store. The released agent status does not
// carry the login type, so `apiKeyState` for `codex` answers from that login: `saved` while Codex runs
// on a key, `missing` otherwise. `apiKeyClear` does not remove the login, as on that computer; the
// ChatGPT sign-in and the released sign-out replace the key. An older host stores such a key and
// never reads it, so a client offers the key only when the host advertises this. The routes, their
// admin gate and their bounds stay as each released provider protocol defines them. Widening any of
// it needs a second capability string.
export const CODEX_API_KEY_CAPABILITY = "codex-api-key-v1";
