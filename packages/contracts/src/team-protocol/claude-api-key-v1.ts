// Frozen optional claude-api-key-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. It
// tells a client that the host reads a Claude key saved through the released `apiKeySet` route of
// providers-v1, v5 or v8. The host keeps the key as its own Claude account, `CLAUDE_API_KEY_ACCOUNT_ID`,
// which provider-accounts-v1 lists and gives to agents as any other account: the agents on it get the
// key as `ANTHROPIC_API_KEY`. The provider's own sign-in uses the key only when it has no claude.ai
// account. An older host stores such a key and never reads it, so a client offers the key only when
// the host advertises this. The routes, their admin gate and their bounds stay as each released
// provider protocol defines them. Widening any of it needs a second capability string.
export const CLAUDE_API_KEY_CAPABILITY = "claude-api-key-v1";

/**
 * The account of a saved Claude key. It has the form of an added account, so every released account
 * check accepts it; a random account id is this one only by a 1 in 2^64 chance.
 */
export const CLAUDE_API_KEY_ACCOUNT_ID = "a0000000000000001";
