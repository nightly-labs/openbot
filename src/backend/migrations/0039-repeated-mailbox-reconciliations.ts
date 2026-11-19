import type { DatabaseSync } from "node:sqlite";
import { deleteOrphanReceipts } from "./0008-baseline";
import type { OpenBotMigration } from "./migration";

function deleteRepeatedMailboxReconciliations(db: DatabaseSync): void {
  db.exec("CREATE TEMP TABLE repeated_mailbox_reconciliations (sequence INTEGER PRIMARY KEY)");
  try {
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
  vacuumAfterCommit: true,
  up: deleteRepeatedMailboxReconciliations,
};
