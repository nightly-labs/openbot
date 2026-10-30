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
  playableMediaKind,
  supportedAttachmentExtensions,
} from "@openbot/contracts/attachment-files";
import {
  legacyTeamCapabilities,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { Effect } from "effect";
import { AttachmentFiles } from "../src/backend/attachment-files";

const workspace = dirname(dirname(import.meta.filename));
const artifactPath = join(workspace, ".openbot-build", "mp4-attachment-e2e", "report.json");

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The `ftyp` box that starts an MP4 file. Import does not decode the video, so the header is enough. */
const video = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f,
  0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

async function run() {
  const root = await mkdtemp(join(tmpdir(), "openbot-mp4-attachment-"));
  try {
    const sharedRoot = join(root, "shared");
    const files = new AttachmentFiles({ userDataPath: join(root, "user-data"), sharedRoot });
    await Effect.runPromise(files.initialize());
    await mkdir(join(root, "sources"), { recursive: true });

    // The user attaches a video. It is stored unchanged, as a file the chat plays.
    const userVideo = join(root, "sources", "clip.mp4");
    await writeFile(userVideo, video);
    const drafts = await Effect.runPromise(files.prepareDrafts([userVideo], []));
    const sent = await Effect.runPromise(
      files.commitMessageTransfer(
        "mp4-transfer",
        { kind: "user" },
        ["recipient"],
        "mp4-message",
        new Date().toISOString(),
        drafts.map((draft) => draft.path),
      ),
    );
    const [inbound] = sent;
    assert.ok(inbound);
    assert.equal(inbound.kind, "file");
    assert.equal(inbound.mimeType, "video/mp4");
    assert.equal(inbound.previewKind, "none");
    assert.equal(inbound.sha256, digest(video));
    assert.deepEqual(await readFile(inbound.path), Buffer.from(video));
    assert.equal(playableMediaKind(inbound.mimeType), "video");

    // A browser or a remote member sends the bytes with its own MIME type. The extension wins, so a
    // video never becomes an image for the provider or a text preview.
    const uploaderTypes = ["image/png", "text/plain", "application/octet-stream", ""];
    const uploaded = await Effect.runPromise(
      files.prepareDrafts(
        [],
        uploaderTypes.map((mimeType, index) => ({ name: `upload-${index}.mp4`, mimeType, bytes: video })),
      ),
    );
    for (const draft of uploaded) {
      assert.equal(draft.kind, "file");
      assert.equal(draft.mimeType, "video/mp4");
      assert.equal(draft.previewKind, "none");
    }

    // The agent returns a video with attach_files_to_response.
    const agentVideo = join(root, "sources", "render.mp4");
    await writeFile(agentVideo, video);
    const handle = await open(agentVideo, "r");
    const generated = await Effect.runPromise(
      files.stageGenerated({ sources: [{ path: agentVideo, handle }], ownerAgentId: "agent" }),
    ).finally(() => handle.close());
    const [outbound] = generated;
    assert.ok(outbound);
    assert.equal(outbound.name, "render.mp4");
    assert.equal(outbound.mimeType, "video/mp4");
    assert.equal(outbound.previewKind, "none");

    // The desktop app opens a video with the default app.
    assert.equal(isOpenableAttachmentName("render.mp4"), true);
    assert.doesNotThrow(() => assertSupportedAttachmentName("render.mp4"));
    // A remote host with media-attachments but without mp4-attachments does not get MP4 files.
    const oldHost = { eml: true, media: true, zip: true, mp4: false };
    assert.equal(supportedAttachmentExtensions(oldHost).includes("mp4"), false);
    assert.equal(supportedAttachmentExtensions(oldHost).includes("mov"), true);
    assert.equal(isSupportedAttachmentNameFor("clip.mp4", oldHost), false);
    assert.equal(isSupportedAttachmentNameFor("clip.mp4", { ...oldHost, mp4: true }), true);
    // A protocol 6 peer reads at most 64 capabilities, so the capability is advertised from protocol 7.
    const legacy = legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES);
    assert.ok(legacy.length <= 64);
    assert.equal(legacy.includes(TEAM_MP4_ATTACHMENTS_CAPABILITY), false);
    assert.equal(teamCapabilitiesForProtocol(7).includes(TEAM_MP4_ATTACHMENTS_CAPABILITY), true);

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
  process.stdout.write(`MP4 attachment E2E passed. Report: ${artifactPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(artifactPath, `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`);
  process.stderr.write(`MP4 attachment E2E failed: ${message}\n`);
  process.exitCode = 1;
}
