import type { DatabaseSync } from "node:sqlite";
import { deleteOrphanReceipts } from "./0008-baseline";
import type { OpenBotMigration } from "./migration";

// A page read wrote its mailbox messages again on each read when only their key order differed from
// the rows (#2224), so a thread can hold thousands of identical `conversation.mailbox-reconciled`
// events in a row. An event goes only when the next event of its thread is the same type with the
// same payload. Replay merges a changed message into the one it names, so applying the same payload
// twice in a row gives what applying it once gives. The last event of each run stays, and with it
// the `last_event_sequence` that the rows it wrote point to.
function deleteRepeatedMailboxReconciliations(db: DatabaseSync): void {
  db.exec("CREATE TEMP TABLE repeated_mailbox_reconciliations (sequence INTEGER PRIMARY KEY)");
  try {
    // `event_type` comes before `payload_json` in a row, so the scan reads a payload only for a pair of
    // reconcile events. The next event comes from the aggregate index.
    db.exec(`
      INSERT INTO repeated_mailbox_reconciliations (sequence)
      SELECT event.sequence
      FROM orchestration_events event
      JOIN orchestration_events next ON next.sequence = (
        SELECT later.sequence FROM orchestration_events later
        WHERE later.aggregate_type = 'thread' AND later.aggregate_id = event.aggregate_id
          AND later.sequence > event.sequence
        ORDER BY later.sequence LIMIT 1
      )
      WHERE event.aggregate_type = 'thread' AND event.event_type = 'conversation.mailbox-reconciled'
        AND next.event_type = event.event_type AND next.payload_json = event.payload_json`);
    db.exec(`
      DELETE FROM projection_thread_activities
      WHERE activity_type = 'conversation.mailbox-reconciled'
        AND last_event_sequence IN (SELECT sequence FROM repeated_mailbox_reconciliations)`);
    db.exec(
      "DELETE FROM orchestration_events WHERE sequence IN (SELECT sequence FROM repeated_mailbox_reconciliations)",
    );
  } finally {
    db.exec("DROP TABLE temp.repeated_mailbox_reconciliations");
  }
  deleteOrphanReceipts(db);
}

export const migration: OpenBotMigration = {
  version: 39,
  name: "repeated-mailbox-reconciliations",
  // Deletes many large rows, so the file gets smaller only after a vacuum.
  vacuumAfterCommit: true,
  up: deleteRepeatedMailboxReconciliations,
};
