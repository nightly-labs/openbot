// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { MailboxStore } from "./mailbox-store";

let root: string;
let store: MailboxStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-mailbox-cleanup-"));
  store = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
  await runCauseEffect(store.initialize());
});

afterEach(async () => {
  await chmod(join(root, "user-data", "attachment-drafts"), 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

it("returns the receipt of a saved message when removing its draft folder fails", async () => {
  const file = join(root, "notes.txt");
  await writeFile(file, "Notes");
  const [draft] = await runCauseEffect(store.prepareImportedAttachments([file], []));
  if (!draft) throw new Error("draft missing");
  // The draft folder cannot be removed once its parent is read-only; reading the file still works.
  await chmod(join(root, "user-data", "attachment-drafts"), 0o500);

  const receipt = await runCauseEffect(
    store.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "With file", draftIds: [draft.id] }),
  );

  // The caller learns which delivery it created, so it can still withdraw it.
  const [delivery] = receipt.deliveries;
  expect(delivery && store.queuedDeliveryIds("chief")).toContain(delivery?.id);
});
