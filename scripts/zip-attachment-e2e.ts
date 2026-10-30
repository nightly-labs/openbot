import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertSupportedAttachmentName,
  isOpenableAttachmentName,
  isSupportedAttachmentNameFor,
  supportedAttachmentExtensions,
} from "@openbot/contracts/attachment-files";
import { Effect } from "effect";
import { unzipSync, zipSync } from "fflate";
import { AttachmentFiles } from "../src/backend/attachment-files";

const workspace = dirname(dirname(import.meta.filename));
const artifactPath = join(workspace, ".openbot-build", "zip-attachment-e2e", "report.json");

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function run() {
  const root = await mkdtemp(join(tmpdir(), "openbot-zip-attachment-"));
  try {
    const sharedRoot = join(root, "shared");
    const files = new AttachmentFiles({ userDataPath: join(root, "user-data"), sharedRoot });
    await Effect.runPromise(files.initialize());
    const archive = zipSync({
      "notes.txt": new TextEncoder().encode("hello"),
      "data/rows.csv": new Uint8Array([1, 2]),
    });
    await mkdir(join(root, "sources"), { recursive: true });

    // The user attaches an archive. It is stored unchanged, as a file with no inline preview.
    const userZip = join(root, "sources", "input.zip");
    await writeFile(userZip, archive);
    const drafts = await Effect.runPromise(files.prepareDrafts([userZip], []));
    const sent = await Effect.runPromise(
      files.commitMessageTransfer(
        "zip-transfer",
        { kind: "user" },
        ["recipient"],
        "zip-message",
        new Date().toISOString(),
        drafts.map((draft) => draft.path),
      ),
    );
    const [inbound] = sent;
    assert.ok(inbound);
    assert.equal(inbound.kind, "file");
    assert.equal(inbound.mimeType, "application/zip");
    assert.equal(inbound.previewKind, "none");
    assert.equal(inbound.sha256, digest(archive));
    assert.deepEqual(Object.keys(unzipSync(await readFile(inbound.path))).sort(), ["data/rows.csv", "notes.txt"]);

    // A browser or a remote member sends the bytes with its own MIME type. The extension wins, so an
    // archive never becomes an image for the provider or a text preview.
    const uploaderTypes = ["image/png", "text/plain", "application/x-zip-compressed", ""];
    const uploaded = await Effect.runPromise(
      files.prepareDrafts(
        [],
        uploaderTypes.map((mimeType, index) => ({ name: `upload-${index}.zip`, mimeType, bytes: archive })),
      ),
    );
    for (const draft of uploaded) {
      assert.equal(draft.kind, "file");
      assert.equal(draft.mimeType, "application/zip");
      assert.equal(draft.previewKind, "none");
    }

    // The agent returns an archive with attach_files_to_response.
    const agentZip = join(root, "sources", "output.zip");
    await writeFile(agentZip, archive);
    const handle = await open(agentZip, "r");
    const generated = await Effect.runPromise(
      files.stageGenerated({ sources: [{ path: agentZip, handle }], ownerAgentId: "agent" }),
    ).finally(() => handle.close());
    const [outbound] = generated;
    assert.ok(outbound);
    assert.equal(outbound.name, "output.zip");
    assert.equal(outbound.mimeType, "application/zip");
    assert.equal(outbound.previewKind, "none");
    assert.deepEqual(await readFile(outbound.path), Buffer.from(archive));

    // An archive can hold programs, so the desktop app shows it in the file manager.
    assert.equal(isOpenableAttachmentName("output.zip"), false);
    assert.doesNotThrow(() => assertSupportedAttachmentName("output.zip"));
    // A remote host without the zip-attachments capability does not get archives.
    const oldHost = { eml: true, media: true, zip: false, mp4: true };
    assert.equal(supportedAttachmentExtensions(oldHost).includes("zip"), false);
    assert.equal(isSupportedAttachmentNameFor("input.zip", oldHost), false);
    assert.equal(isSupportedAttachmentNameFor("input.zip", { ...oldHost, zip: true }), true);

    return {
      status: "pass",
      inbound: {
        name: inbound.name,
        mimeType: inbound.mimeType,
        previewKind: inbound.previewKind,
        sha256: inbound.sha256,
      },
      uploads: uploaderTypes.map((sent, index) => ({ sent, stored: uploaded[index]?.mimeType })),
      outbound: { name: outbound.name, mimeType: outbound.mimeType, previewKind: outbound.previewKind },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await mkdir(dirname(artifactPath), { recursive: true });
try {
  const report = await run();
  await writeFile(
    artifactPath,
    `${JSON.stringify(
      { ...report, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim() },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`ZIP attachment E2E passed. Report: ${artifactPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(artifactPath, `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`);
  process.stderr.write(`ZIP attachment E2E failed: ${message}\n`);
  process.exitCode = 1;
}
