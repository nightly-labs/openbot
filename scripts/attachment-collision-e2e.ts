import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Effect } from "effect";
import { AttachmentFiles } from "../src/backend/attachment-files";

const workspace = dirname(dirname(import.meta.filename));
const artifactPath = join(workspace, ".openbot-build", "attachment-collision-e2e.json");

interface AttachmentSource {
  name: string;
  path: string;
  bytes: Buffer;
  sha256: string;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function filenameCollision(root: string, first: string, second: string): Promise<boolean> {
  await mkdir(root, { recursive: true });
  const source = join(root, "probe-source");
  await writeFile(source, "probe");
  await copyFile(source, join(root, first), constants.COPYFILE_EXCL);
  try {
    await copyFile(source, join(root, second), constants.COPYFILE_EXCL);
    return false;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST") return true;
    throw error;
  }
}

async function run() {
  const root = await mkdtemp(join(tmpdir(), "openbot-attachment-collision-"));
  try {
    const sharedRoot = join(root, "shared");
    const files = new AttachmentFiles({ userDataPath: join(root, "user-data"), sharedRoot });
    await Effect.runPromise(files.initialize());
    const asciiCollision = await filenameCollision(join(sharedRoot, "ascii-probe"), "File.txt", "file.txt");
    const sigmaCollision = await filenameCollision(join(sharedRoot, "sigma-probe"), "ς.txt", "σ.txt");
    const names = ["plain.txt", "File.txt", "file.txt", "File.txt", "ς.txt", "σ.txt", "ς.txt", "σ.txt"];
    const sources: AttachmentSource[] = [];
    for (const [index, name] of names.entries()) {
      const directory = join(root, "sources", String(index));
      await mkdir(directory, { recursive: true });
      const path = join(directory, name);
      const bytes = Buffer.from(`source-${index}`);
      await writeFile(path, bytes);
      sources.push({ name, path, bytes, sha256: digest(bytes) });
    }
    assert.equal(new Set(sources.map((source) => source.bytes.length)).size, 1);
    const drafts = await Effect.runPromise(
      files.prepareDrafts(
        sources.map((source) => source.path),
        [],
      ),
    );
    assert.equal(drafts.length, sources.length);
    for (const [index, draft] of drafts.entries()) {
      const source = sources[index];
      assert.ok(source);
      assert.equal(draft.name, source.name);
      assert.equal(draft.sha256, source.sha256);
      assert.deepEqual(await readFile(draft.path), source.bytes);
      assert.ok(await Effect.runPromise(files.resolveDraft(draft)));
    }
    const transferId = "collision-transfer";
    const messageId = "collision-message";
    const createdAt = new Date().toISOString();
    const attachments = await Effect.runPromise(
      files.commitMessageTransfer(
        transferId,
        { kind: "user" },
        ["recipient"],
        messageId,
        createdAt,
        drafts.map((draft) => draft.path),
      ),
    );
    assert.equal(attachments.length, sources.length);
    assert.equal(new Set(attachments.map((attachment) => attachment.path)).size, sources.length);
    assert.equal(new Set(attachments.map((attachment) => attachment.sha256)).size, sources.length);
    for (const [index, attachment] of attachments.entries()) {
      const source = sources[index];
      assert.ok(source);
      assert.equal(attachment.sha256, source.sha256);
      assert.equal(attachment.size, source.bytes.length);
      assert.equal(basename(attachment.path), attachment.name);
      assert.deepEqual(await readFile(attachment.path), source.bytes);
      const resolved = await Effect.runPromise(files.resolveTransfer(attachment));
      assert.ok(resolved);
      assert.deepEqual(await readFile(resolved.path), source.bytes);
    }
    assert.deepEqual(
      attachments.slice(0, 4).map((attachment) => attachment.name),
      ["plain.txt", "File.txt", "file-2.txt", "File-3.txt"],
    );
    const transferRoot = files.transferRoot(transferId);
    const storedNames = attachments.map((attachment) => attachment.name);
    assert.equal(new Set(storedNames).size, sources.length);
    assert.deepEqual((await readdir(transferRoot)).sort(), [".openbot-transfer.json", ...storedNames].sort());
    const manifest = JSON.parse(await readFile(join(transferRoot, ".openbot-transfer.json"), "utf8"));
    assert.deepEqual(manifest, {
      version: 2,
      kind: "message-transfer",
      transferId,
      messageId,
      sender: { kind: "user" },
      recipientAgentIds: ["recipient"],
      createdAt,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        relativePath: attachment.name,
        size: attachment.size,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        previewKind: attachment.previewKind,
        sha256: attachment.sha256,
      })),
    });
    assert.deepEqual(await readdir(join(sharedRoot, "Transfers")), [transferId]);
    return {
      status: "pass",
      filesystem: { asciiCollision, sigmaCollision },
      attachments: attachments.map((attachment, index) => ({
        sourceName: sources[index]?.name,
        name: attachment.name,
        size: attachment.size,
        sha256: attachment.sha256,
        resolved: true,
      })),
      manifest,
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
      {
        ...report,
        head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim(),
        implementationSha256: digest(await readFile(join(workspace, "src/backend/attachment-files.ts"))),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Attachment collision E2E passed. Report: ${artifactPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(artifactPath, `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`);
  process.stderr.write(`Attachment collision E2E failed: ${message}\n`);
  process.exitCode = 1;
}
