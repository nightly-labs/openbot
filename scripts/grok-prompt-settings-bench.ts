import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveGrokCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import {
  type GrokRequest,
  grokEnvironment,
  makeGitWorkspace,
  makeGrokHome,
  startGrokProxy,
  type TomlValue,
} from "./grok-live-harness";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-prompt-settings-bench");
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt with the read_file tool. Then reply with one line: the title of notes.md and the number in count.txt.";
const DEVELOPER_INSTRUCTIONS = "You are Ada, a careful assistant in an end-to-end benchmark.";

interface Variant {
  name: string;
  config?: Record<string, TomlValue>;
  env?: Record<string, string>;
}

const OPENBOT_SETTINGS: Record<string, TomlValue> = {
  "features.feedback": true,
  "workflows.enabled": true,
  "features.turn_summary": true,
  "compat.claude.skills": true,
};

const REFERENCES: Variant[] = [
  { name: "video-gen-off", config: { "features.video_gen": false } },
  { name: "image-gen-off", config: { "features.image_gen": false } },
  { name: "image-edit-off", env: { GROK_IMAGE_EDIT: "0" } },
  { name: "ask-user-question-off", config: { "features.ask_user_question": false } },
  { name: "subagents-off", config: { "subagents.enabled": false } },
  { name: "web-search-off", config: { disable_web_search: true } },
  { name: "x-search-off", config: { "features.backend_tools": false } },
];

const VARIANTS: Variant[] = [
  { name: "current" },
  { name: "without-openbot-settings", config: OPENBOT_SETTINGS },
  ...REFERENCES,
];

interface TurnReport {
  step: string;
  status: string | null;
  error: string | null;
  requests: GrokRequest[];
  firstRequestPrompt: number;
  mainPrompt: number;
  totalPrompt: number;
}

interface RunReport {
  variant: string;
  userSetup: boolean;
  config: Record<string, TomlValue>;
  env: Record<string, string>;
  turns: TurnReport[];
  error?: string;
}

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const onlyVariant = argument("variant");
const onlySetup = argument("setup");
const MODEL = argument("model") ?? "grok-4.7-build-fast";
const variants = onlyVariant ? VARIANTS.filter((variant) => variant.name === onlyVariant) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${onlyVariant}`);
const setups = onlySetup ? [onlySetup === "on"] : [false, true];

const proxy = await startGrokProxy();
const saved = { ...process.env };
const cli = await runCauseEffect(resolveGrokCli({ bundledExecutable: process.env.GROK_CLI ?? null }));
const report: { grokVersion: string; model: string; runs: RunReport[] } = {
  grokVersion: cli.version,
  model: MODEL,
  runs: [],
};
const sum = (requests: GrokRequest[]) => requests.reduce((total, request) => total + request.input, 0);

for (const userSetup of setups) {
  for (const variant of variants) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-grok-prompt-bench-")));
    const run: RunReport = {
      variant: variant.name,
      userSetup,
      config: variant.config ?? {},
      env: variant.env ?? {},
      turns: [],
    };
    const clients: AgentClient[] = [];
    try {
      const grokHome = await makeGrokHome(root, { config: variant.config ?? {}, userSetup });
      const workspace = join(root, "workspace");
      makeGitWorkspace(workspace);
      process.env = { ...grokEnvironment(root, grokHome, proxy.port), ...variant.env };
      const client = requireProviderDriver("grok").createClient(cli, 120_000, NO_PROVIDER_CREDENTIALS);
      clients.push(client);
      client.start();
      for (const [step, text] of [
        ["reply", REPLY_PROMPT],
        ["task", TASK_PROMPT],
      ] as const) {
        const first = proxy.requests.length;
        const thread = await startThread(client, {
          cwd: workspace,
          model: MODEL,
          developerInstructions: DEVELOPER_INSTRUCTIONS,
        });
        const turn = await runTurn(client, thread, { model: MODEL, text, timeoutMs: 180_000 });
        await proxy.idle();
        const requests = proxy.requests.slice(first);
        const main = requests.filter((request) => request.kind === "main");
        run.turns.push({
          step,
          status: turn.status,
          error: turn.error,
          requests,
          firstRequestPrompt: main[0]?.input ?? 0,
          mainPrompt: sum(main),
          totalPrompt: sum(requests),
        });
        if (turn.status !== "completed") throw new Error(`Turn ${step} ended ${turn.status}: ${turn.error ?? ""}`);
        if (!main[0]?.input) throw new Error(`Turn ${step} has no main request with usage.`);
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      await stopClients(clients);
      process.env = { ...saved };
      await rm(root, { recursive: true, force: true });
    }
    report.runs.push(run);
    const [reply, task] = run.turns;
    const kinds = (turn: TurnReport | undefined) =>
      turn ? turn.requests.map((request) => request.kind[0]).join("") : "-";
    const tools = reply?.requests.find((request) => request.kind === "main")?.tools.length;
    process.stdout.write(
      `${variant.name.padEnd(26)} setup=${userSetup ? "on " : "off"} ` +
        `reply.prompt=${reply?.firstRequestPrompt ?? "-"} reply.total=${reply?.totalPrompt ?? "-"} ` +
        `task.main=${task?.mainPrompt ?? "-"} task.total=${task?.totalPrompt ?? "-"} ` +
        `requests=${kinds(reply)}/${kinds(task)} tools=${tools ?? "-"}` +
        `${run.error ? ` (failed: ${run.error})` : ""}\n`,
    );
  }
}

proxy.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.runs.some((run) => run.error) ? 1 : 0);
