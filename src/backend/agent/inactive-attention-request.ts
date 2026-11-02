/**
 * An answer to a prompt or approval that no longer waits: another client answered it, or its turn
 * ended. The Team API answers it as a conflict, so a client can drop the stale request.
 */
export class InactiveAttentionRequest extends Error {}

/**
 * A UI block answer that only the server owner or an admin may give, from a member. The Team API
 * answers it as forbidden, and the block stays open for an answer that the member may give.
 */
export class ForbiddenAttentionAnswer extends Error {}
