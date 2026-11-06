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
} from "@openbot/contracts/attachment-files";
import {
  legacyTeamCapabilities,
  TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V9_ONLY_CAPABILITIES,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9_CAPABILITY_LIMIT } from "@openbot/contracts/team-protocol/v9";
import { Effect } from "effect";
import { AttachmentFiles } from "../src/backend/attachment-files";

// #4984: a file whose name has no known type is attached as an opaque file, and the agent gets its
// path. A remote host without any-file-attachments still gets only the known types.

const workspace = dirname(dirname(import.meta.filename));
const artifactPath = join(workspace, ".openbot-build", "any-file-attachment-e2e", "report.json");

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const profile = new TextEncoder().encode("client\ndev tun\nproto udp\nremote vpn.example.com 1195\n");
const binary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0xff, 0xfe, 0x00]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function run() {
  const root = await mkdtemp(join(tmpdir(), "openbot-any-file-attachment-"));
  try {
    const sharedRoot = join(root, "shared");
    const files = new AttachmentFiles({ userDataPath: join(root, "user-data"), sharedRoot });
    await Effect.runPromise(files.initialize());
    await mkdir(join(root, "sources"), { recursive: true });

    // The user picks files with unknown types: text, binary, and a name with no extension. Each one
    // is stored unchanged as an opaque file, so the agent gets its path.
    const picked = [
      { name: "FWSRV01-UDP4-1195-config.ovpn", bytes: profile },
      { name: "firmware.bin", bytes: binary },
      { name: "kubeconfig", bytes: profile },
    ];
    const paths: string[] = [];
    for (const file of picked) {
      const path = join(root, "sources", file.name);
      await writeFile(path, file.bytes);
      paths.push(path);
    }
    const drafts = await Effect.runPromise(files.prepareDrafts(paths, []));
    const sent = await Effect.runPromise(
      files.commitMessageTransfer(
        "any-file-transfer",
        { kind: "user" },
        ["recipient"],
        "any-file-message",
        new Date().toISOString(),
        drafts.map((draft) => draft.path),
      ),
    );
    assert.equal(sent.length, picked.length);
    for (const [index, file] of picked.entries()) {
      const inbound = sent[index];
      assert.ok(inbound);
      assert.equal(inbound.name, file.name);
      assert.equal(inbound.kind, "file");
      assert.equal(inbound.mimeType, "application/octet-stream");
      assert.equal(inbound.previewKind, "none");
      assert.equal(inbound.sha256, digest(file.bytes));
      assert.deepEqual(await readFile(inbound.path), Buffer.from(file.bytes));
      // The desktop app shows an unknown file in the file manager and never opens it.
      assert.equal(isOpenableAttachmentName(file.name), false);
    }

    // A browser or a remote member sends the bytes with its own MIME type. With an unknown name, the
    // type is dropped: the sent message takes its type from the name, so the draft must match it, and
    // a HEIC must not become an image block that a provider refuses. A known name keeps its type.
    const uploads = [
      { name: "IMG_0001.HEIC", mimeType: "image/heic", bytes: png, kind: "file", stored: "application/octet-stream" },
      {
        name: "office.ovpn",
        mimeType: "application/x-openvpn-profile",
        bytes: profile,
        kind: "file",
        stored: "application/octet-stream",
      },
      { name: "song.ogg", mimeType: "audio/ogg", bytes: binary, kind: "file", stored: "application/octet-stream" },
      { name: "screenshot.png", mimeType: "image/png", bytes: png, kind: "image", stored: "image/png" },
    ];
    const uploaded = await Effect.runPromise(
      files.prepareDrafts(
        [],
        uploads.map(({ name, mimeType, bytes }) => ({ name, mimeType, bytes })),
      ),
    );
    const uploadedSent = await Effect.runPromise(
      files.commitMessageTransfer(
        "upload-transfer",
        { kind: "user" },
        ["recipient"],
        "upload-message",
        new Date().toISOString(),
        uploaded.map((draft) => draft.path),
      ),
    );
    for (const [index, upload] of uploads.entries()) {
      const draft = uploaded[index];
      const sentUpload = uploadedSent[index];
      assert.ok(draft && sentUpload);
      assert.equal(draft.name, upload.name);
      assert.equal(draft.kind, upload.kind, upload.name);
      assert.equal(draft.mimeType, upload.stored, upload.name);
      assert.equal(sentUpload.kind, draft.kind, upload.name);
      assert.equal(sentUpload.mimeType, draft.mimeType, upload.name);
      assert.equal(sentUpload.previewKind, draft.previewKind, upload.name);
    }

    // The voice recording keeps its audio type, so the message can replay it.
    const [voice] = await Effect.runPromise(
      files.prepareDrafts([], [{ name: "voice.webm", mimeType: "audio/webm", bytes: binary }], {
        voiceRecording: true,
      }),
    );
    assert.equal(voice?.mimeType, "audio/webm");

    // The agent returns a file with an unknown type with attach_files_to_response.
    const agentFile = join(root, "sources", "main.tf");
    await writeFile(agentFile, profile);
    const handle = await open(agentFile, "r");
    const generated = await Effect.runPromise(
      files.stageGenerated({ sources: [{ path: agentFile, handle }], ownerAgentId: "agent" }),
    ).finally(() => handle.close());
    const [outbound] = generated;
    assert.ok(outbound);
    assert.equal(outbound.name, "main.tf");
    assert.equal(outbound.kind, "file");
    assert.equal(outbound.mimeType, "application/octet-stream");

    // A remote host without any-file-attachments refuses the name, with the message of before.
    const oldHost = { eml: true, media: true, zip: true, mp4: true, svg: true, anyFile: false };
    assert.equal(isSupportedAttachmentNameFor("office.ovpn", oldHost), false);
    assert.equal(isSupportedAttachmentNameFor("kubeconfig", oldHost), false);
    assert.equal(isSupportedAttachmentNameFor("notes.txt", oldHost), true);
    assert.throws(() => assertSupportedAttachmentName("office.ovpn"), /office\.ovpn is not supported\./u);
    const newHost = { ...oldHost, anyFile: true };
    assert.equal(isSupportedAttachmentNameFor("office.ovpn", newHost), true);
    assert.equal(isSupportedAttachmentNameFor("kubeconfig", newHost), true);
    // The other capabilities still decide their own types.
    assert.equal(isSupportedAttachmentNameFor("logo.svg", { ...newHost, svg: false }), false);
    // Protocols 6 to 8 have full capability lists, so only a protocol 9 peer gets the capability.
    assert.equal(
      legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES).includes(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY),
      false,
    );
    assert.equal(TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY), true);
    assert.equal(teamCapabilitiesForProtocol(8).includes(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY), false);
    assert.equal(teamCapabilitiesForProtocol(9).includes(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY), true);
    assert.ok(teamCapabilitiesForProtocol(8).length <= 128);
    assert.ok(TEAM_CURRENT_CAPABILITIES.length <= TEAM_PROTOCOL_V9_CAPABILITY_LIMIT);

    return {
      status: "pass",
      picked: sent.map((item) => ({
        name: item.name,
        kind: item.kind,
        mimeType: item.mimeType,
        previewKind: item.previewKind,
        sha256: item.sha256,
      })),
      uploads: uploads.map((upload, index) => ({
        name: upload.name,
        sent: upload.mimeType,
        stored: uploaded[index]?.mimeType,
        kind: uploaded[index]?.kind,
        sentMimeType: uploadedSent[index]?.mimeType,
      })),
      voice: voice?.mimeType,
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
  process.stdout.write(`Any file attachment E2E passed. Report: ${artifactPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(artifactPath, `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`);
  process.stderr.write(`Any file attachment E2E failed: ${message}\n`);
  process.exitCode = 1;
}
