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
import {
  legacyTeamCapabilities,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V9_ONLY_CAPABILITIES,
  TEAM_SVG_ATTACHMENTS_CAPABILITY,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9_CAPABILITY_LIMIT } from "@openbot/contracts/team-protocol/v9";
import { Effect } from "effect";
import { AttachmentFiles } from "../src/backend/attachment-files";

const workspace = dirname(dirname(import.meta.filename));
const artifactPath = join(workspace, ".openbot-build", "svg-attachment-e2e", "report.json");

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const drawing = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>\n',
);

async function run() {
  const root = await mkdtemp(join(tmpdir(), "openbot-svg-attachment-"));
  try {
    const sharedRoot = join(root, "shared");
    const files = new AttachmentFiles({ userDataPath: join(root, "user-data"), sharedRoot });
    await Effect.runPromise(files.initialize());
    await mkdir(join(root, "sources"), { recursive: true });

    // The user attaches an SVG. It is stored unchanged. It is a file, so the agent gets its path and
    // not a raster image block, and the chat shows it as an image.
    const userDrawing = join(root, "sources", "logo.svg");
    await writeFile(userDrawing, drawing);
    const drafts = await Effect.runPromise(files.prepareDrafts([userDrawing], []));
    const sent = await Effect.runPromise(
      files.commitMessageTransfer(
        "svg-transfer",
        { kind: "user" },
        ["recipient"],
        "svg-message",
        new Date().toISOString(),
        drafts.map((draft) => draft.path),
      ),
    );
    const [inbound] = sent;
    assert.ok(inbound);
    assert.equal(inbound.kind, "file");
    assert.equal(inbound.mimeType, "image/svg+xml");
    assert.equal(inbound.previewKind, "image");
    assert.equal(inbound.sha256, digest(drawing));
    assert.deepEqual(await readFile(inbound.path), Buffer.from(drawing));

    // A browser or a remote member sends the bytes with its own MIME type. The extension wins, so an
    // SVG never becomes a raster image for the provider.
    const uploaderTypes = ["image/png", "image/svg+xml", "text/plain", "application/octet-stream", ""];
    const uploaded = await Effect.runPromise(
      files.prepareDrafts(
        [],
        uploaderTypes.map((mimeType, index) => ({ name: `upload-${index}.svg`, mimeType, bytes: drawing })),
      ),
    );
    for (const draft of uploaded) {
      assert.equal(draft.kind, "file");
      assert.equal(draft.mimeType, "image/svg+xml");
      assert.equal(draft.previewKind, "image");
    }

    // The agent returns an SVG with attach_files_to_response.
    const agentDrawing = join(root, "sources", "chart.svg");
    await writeFile(agentDrawing, drawing);
    const handle = await open(agentDrawing, "r");
    const generated = await Effect.runPromise(
      files.stageGenerated({ sources: [{ path: agentDrawing, handle }], ownerAgentId: "agent" }),
    ).finally(() => handle.close());
    const [outbound] = generated;
    assert.ok(outbound);
    assert.equal(outbound.name, "chart.svg");
    assert.equal(outbound.kind, "file");
    assert.equal(outbound.mimeType, "image/svg+xml");
    assert.equal(outbound.previewKind, "image");

    // A browser can run an SVG as a page, so the desktop app does not open it with the default app.
    assert.equal(isOpenableAttachmentName("chart.svg"), false);
    assert.doesNotThrow(() => assertSupportedAttachmentName("chart.svg"));
    // A remote host without svg-attachments does not get SVG files.
    const oldHost = { eml: true, media: true, zip: true, mp4: true, svg: false };
    assert.equal(supportedAttachmentExtensions(oldHost).includes("svg"), false);
    assert.equal(supportedAttachmentExtensions(oldHost).includes("png"), true);
    assert.equal(isSupportedAttachmentNameFor("logo.svg", oldHost), false);
    assert.equal(isSupportedAttachmentNameFor("logo.svg", { ...oldHost, svg: true }), true);
    // Protocols 6 to 8 have full capability lists, so only a protocol 9 peer gets the capability.
    assert.equal(legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES).includes(TEAM_SVG_ATTACHMENTS_CAPABILITY), false);
    assert.equal(TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(TEAM_SVG_ATTACHMENTS_CAPABILITY), true);
    assert.equal(teamCapabilitiesForProtocol(8).includes(TEAM_SVG_ATTACHMENTS_CAPABILITY), false);
    assert.equal(teamCapabilitiesForProtocol(9).includes(TEAM_SVG_ATTACHMENTS_CAPABILITY), true);
    assert.ok(teamCapabilitiesForProtocol(8).length <= 128);
    assert.ok(TEAM_CURRENT_CAPABILITIES.length <= TEAM_PROTOCOL_V9_CAPABILITY_LIMIT);

    return {
      status: "pass",
      inbound: {
        name: inbound.name,
        kind: inbound.kind,
        mimeType: inbound.mimeType,
        previewKind: inbound.previewKind,
        sha256: inbound.sha256,
      },
      uploads: uploaderTypes.map((sent, index) => ({ sent, stored: uploaded[index]?.mimeType })),
      outbound: { name: outbound.name, kind: outbound.kind, mimeType: outbound.mimeType },
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
  process.stdout.write(`SVG attachment E2E passed. Report: ${artifactPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(artifactPath, `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`);
  process.stderr.write(`SVG attachment E2E failed: ${message}\n`);
  process.exitCode = 1;
}
