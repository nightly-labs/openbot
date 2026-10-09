/**
 * An answer to a prompt or approval that no longer waits: another client answered it, or its turn
 * ended. The Team API answers it as a conflict, so a client can drop the stale request.
 */
export class InactiveAttentionRequest extends Error {}
