// Runs the real `acp` provider driver over three fake agents to check that attached audio and video
// reach a model that takes them (#4210). The "gemini" agent takes audio and embedded context, as
// Gemini CLI does: an MP3 must come as an audio block, and an MP4 or MOV as an embedded resource, with
// unchanged bytes. The "opencode" and "plain" agents take no audio: each file must come as its path
// only. A prompt carries at most 10 MiB of media; a file that does not fit goes as its path only.
// `bun run test:acp-media-input`. Writes .openbot-build/acp-media-input-e2e/report.json.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-media-input-e2e");
const MODES = ["gemini", "opencode", "plain"] as const;
type Mode = (typeof MODES)[number];
const MIB = 1024 * 1024;

interface Block {
  index: number;
  type: string;
  text: string | null;
  mimeType: string | null;
  uri: string | null;
  sha256: string | null;
}

interface Fixture {
  name: string;
  mimeType: string;
  path: string;
  sha256: string;
}

/** What the agent must get for one attached file: its path, then the bytes when they go inline. */
type Expected = { file: Fixture; inline: "audio" | "resource" | null };

interface Report {
  passed: boolean;
  agents: Partial<Record<Mode, { turns: { name: string; status: string | null; blocks: Block[] }[] }>>;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-media-e2e-"));
const report: Report = { passed: false, agents: {} };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const files = join(root, "attachments");
  await mkdir(workspace);
  await mkdir(files);
  await installFakeAgent(executable, "media-input");

  // The fakes do not decode the media, so random bytes test that the bytes are unchanged.
  const fixture = async (name: string, mimeType: string, size: number): Promise<Fixture> => {
    const bytes = randomBytes(size);
    const path = join(files, name);
    await writeFile(path, bytes);
    return { name, mimeType, path, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const mp3 = await fixture("voice note.mp3", "audio/mpeg", 64 * 1024);
  const mp4 = await fixture("clip.mp4", "video/mp4", 128 * 1024);
  const mov = await fixture("screen.mov", "video/quicktime", 96 * 1024);
  const pdf = await fixture("report.pdf", "application/pdf", 4 * 1024);
  const large = await fixture("long talk.mp3", "audio/mpeg", 11 * MIB);
  const firstHalf = await fixture("part one.mp3", "audio/mpeg", 6 * MIB);
  const secondHalf = await fixture("part two.mp4", "video/mp4", 6 * MIB);

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  for (const mode of MODES) {
    await runCauseEffect(
      store.save({
        id: `media-${mode}`,
        name: mode,
        command: executable,
        args: [],
        env: [
          { name: "FAKE_MODE", value: mode },
          { name: "FAKE_LOG", value: join(root, `${mode}.jsonl`) },
        ],
        usagePrompt: null,
      }),
    );
  }

  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());

  for (const mode of MODES) {
    const model = `media-${mode}/default`;
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    const thread = await startThread(client, { model, cwd: workspace, runtimeWorkspaceRoots: [workspace] });
    const media = mode === "gemini";
    const turns: { name: string; files: Expected[] }[] = [
      {
        name: "small",
        files: [
          { file: mp3, inline: media ? "audio" : null },
          { file: mp4, inline: media ? "resource" : null },
          { file: mov, inline: media ? "resource" : null },
          { file: pdf, inline: null },
        ],
      },
      { name: "too-large", files: [{ file: large, inline: null }] },
      {
        name: "over-budget",
        files: [
          { file: firstHalf, inline: media ? "audio" : null },
          { file: secondHalf, inline: null },
        ],
      },
    ];
    const log = join(root, `${mode}.jsonl`);
    const results: { name: string; status: string | null; blocks: Block[] }[] = [];
    report.agents[mode] = { turns: results };
    let seen = 0;
    for (const turn of turns) {
      const result = await runTurn(client, thread, {
        model,
        text: turn.name,
        attachments: turn.files.map(({ file }) => ({ type: "mention", name: file.name, path: file.path })),
      });
      const blocks = (await readJsonl<Block>(log)).slice(seen);
      seen += blocks.length;
      results.push({ name: turn.name, status: result.status, blocks });
      assert.equal(result.status, "completed", `${mode} ${turn.name}: the turn completes.`);
      check(`${mode} ${turn.name}`, blocks, turn.name, turn.files);
    }
    await runCauseEffect(client.stop());
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/** The prompt starts with the text; each file then gives its path and, when inline, its bytes. */
function check(label: string, blocks: readonly Block[], text: string, files: readonly Expected[]): void {
  const [first, ...rest] = blocks;
  assert.equal(first?.type, "text", `${label}: the prompt starts with the text.`);
  assert.ok(first?.text?.includes(text), `${label}: the first block has the message.`);
  const expected = files.flatMap(({ file, inline }) => [
    { type: "text", text: `Attached local file: ${file.path}`, mimeType: null, uri: null, sha256: null },
    ...(inline === "audio"
      ? [{ type: "audio", text: null, mimeType: file.mimeType, uri: null, sha256: file.sha256 }]
      : inline === "resource"
        ? [
            {
              type: "resource",
              text: null,
              mimeType: file.mimeType,
              uri: pathToFileURL(file.path).href,
              sha256: file.sha256,
            },
          ]
        : []),
  ]);
  assert.deepEqual(
    rest.map(({ type, text, mimeType, uri, sha256 }) => ({ type, text, mimeType, uri, sha256 })),
    expected,
    `${label}: each file comes as its path, and inline only when the agent takes it and it fits.`,
  );
}
