# Retain prior history when a user rewrites a chat message

Status: proposed for [issue #4348](https://github.com/nightly-labs/openbot/issues/4348).

A user can edit the text of a finished user message in an agent main thread or side thread. Editing
opens a draft and does not change the thread. Cancel keeps the active conversation. When the user
sends the edited message, OpenBot rewinds the same thread to before that turn, sends a new user
message with the original attachments, and starts a new answer. Later messages and answers leave
the active conversation. The user cannot edit while that thread has a running or queued turn.
Shared channels are outside this change.

The prior conversation must stay in private, durable history. OpenBot does not show a restore
control in this feature. The active conversation is the only history shown in chat, sent to a
provider, or used to start a side thread. A rewind must end the old provider session so that a
provider cannot resume with the removed messages. It does not undo changes to workspace files.
Deleting a thread must also delete its retained history and attachment references.

The current conversation writer removes messages that are absent from a new snapshot and prunes
older snapshot events. A direct snapshot cut would lose the prior conversation. Store the prior
version before the active history changes, and make both changes in one durable operation. This
adds storage cost but protects the old conversation from an accidental edit and matches Codex's
retention behavior.

The cut uses conversation order, not enqueue timestamps: a queued question can be stored before
the preceding answer finishes. All mailbox producers share the same enqueue lock while a rewrite
rechecks its source, queues the replacement, and ends the old context. Restart recovery finishes
a committed replacement's cut before providers can drain it. Provider-history imports keep their
raw records but exclude archived message IDs and removed turns from the active conversation.

A missing sender in a conversation projection can be recovered only from the host-stamped mailbox
delivery for that agent and conversation lane. If both records lack a sender, remote authorship
cannot be proved; those messages remain editable on the local host. This is an outstanding scope
exception for remote clients, not an inference that the current member owns old messages.

Repeatable checks:

- `bun scripts/thread-rewind-e2e.ts` writes its report under `.openbot-build/thread-rewind-e2e/`.
- `bun scripts/thread-rewrite-service-e2e.ts` restarts the complete service, database and a separate
  deterministic provider process, then verifies completed history imports and subsequent turns.
- `bun scripts/thread-rewrite-ui-e2e.ts --allow-mutations` drives Edit, Cancel and Resend in main and
  side threads on this worktree's isolated desktop dev profile using a signed-in live Codex model.
  After stopping and starting that stack, `--verify-restart --allow-mutations` checks new provider
  turns and retained active history. Reports and screenshots stay under `.openbot-build/`.
