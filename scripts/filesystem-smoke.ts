import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import { codexSandboxConfig, codexSandboxMode, codexSandboxPolicy } from "../src/backend/agent/workspace-sandbox";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { resolveClaudeCli, resolveCodexCli } from "../src/backend/cli";
import {
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
  getString,
  isRecord,
  type RequestId,
} from "../src/backend/protocol";

const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-filesystem-smoke-"));
const sharedRoot = join(temporaryRoot, "shared");
const useImagegen = process.argv.includes("--imagegen");
const workspaceOnly = process.argv.includes("--workspace-only");
// Codex lets a sandboxed command write in the temporary folders, so the folder that an agent must
// not write to is here, outside them. The reports stay here too.
const reportRoot = resolve(".openbot-build/workspace-only-smoke");
const providers = requestedProviders();

try {
  await mkdir(sharedRoot, { recursive: true });
  if (useImagegen) {
    if (providers.length !== 1 || providers[0] !== "codex") {
      throw new Error("Image generation smoke only supports --provider codex.");
    }
    await runImagegenSmoke();
  } else if (workspaceOnly) {
    await mkdir(reportRoot, { recursive: true });
    for (const provider of providers) await runWorkspaceOnlySmoke(provider);
  } else {
    await writeFile(join(sharedRoot, "shared-seed.txt"), "OPENBOT_SHARED_SEED\n");
    const completedProviders: AgentProvider[] = [];
    for (const provider of providers) {
      await runFilesystemSmoke(provider, completedProviders);
      completedProviders.push(provider);
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runFilesystemSmoke(provider: AgentProvider, completedProviders: AgentProvider[]): Promise<void> {
  const workspaceRoot = join(temporaryRoot, `workspace-${provider}`);
  const workspaceSeedPath = join(workspaceRoot, "workspace-seed.txt");
  const deletePath = join(workspaceRoot, "delete-me.txt");
  const temporaryPath = join(workspaceRoot, "rename-me.txt");
  const workspaceResultPath = join(workspaceRoot, "workspace-result.txt");
  const persistenceResultPath = join(workspaceRoot, "persistence-result.txt");
  const sharedResultPath = join(sharedRoot, `${provider}-shared-result.txt`);
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(workspaceSeedPath, `OPENBOT_${provider.toUpperCase()}_WORKSPACE_SEED\n`);
  await writeFile(deletePath, "DELETE_ME\n");
  await writeFile(temporaryPath, "RENAME_ME\n");

  const { client, model, version } = await createClient(provider);
  let approvals = 0;
  client.on("request", (request) => {
    if (isApprovalRequest(request.method)) approvals += 1;
    respondToServerRequest(client, request);
  });
  client.start();
  try {
    await initialize(client);
    const started = await client.request(
      "thread/start",
      {
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "on-request",
        sandbox: "danger-full-access",
        ephemeral: provider === "codex",
        persistSession: false,
        serviceName: "openbot_filesystem_smoke",
        developerInstructions: [
          "This is an isolated local filesystem smoke test.",
          `Your persistent workspace is ${workspaceRoot}.`,
          `The persistent shared directory is ${sharedRoot}.`,
          "You have full filesystem and command access. Do not use the network or modify files outside those directories.",
        ].join("\n"),
      },
      decodeThreadResponse,
    );

    const completion = waitForTurn(client, 180_000);
    await client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "dangerFullAccess" },
        input: [
          {
            type: "text",
            text: [
              "Use local system commands for every step.",
              `Run pwd and verify it prints ${workspaceRoot}.`,
              `Run ls and grep to verify ${workspaceSeedPath} contains OPENBOT_${provider.toUpperCase()}_WORKSPACE_SEED.`,
              `Run grep to verify ${join(sharedRoot, "shared-seed.txt")} contains OPENBOT_SHARED_SEED.`,
              ...completedProviders.map(
                (completedProvider) =>
                  `Run grep to verify ${join(sharedRoot, `${completedProvider}-shared-result.txt`)} contains OPENBOT_${completedProvider.toUpperCase()}_SHARED_OK.`,
              ),
              `Replace ${temporaryPath} with ${workspaceResultPath} using mv, then write exactly OPENBOT_${provider.toUpperCase()}_WORKSPACE_OK followed by one newline to it.`,
              `Delete ${deletePath} using rm.`,
              `Write exactly OPENBOT_${provider.toUpperCase()}_SHARED_OK followed by one newline to ${sharedResultPath}.`,
              "Verify the results with local commands, then finish with a short confirmation.",
            ].join("\n"),
          },
        ],
      },
      decodeTurnResponse,
    );
    await completion;

    const persistenceCompletion = waitForTurn(client, 180_000);
    await client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "dangerFullAccess" },
        input: [
          {
            type: "text",
            text: [
              `In this new turn, run grep to confirm ${workspaceResultPath} still contains OPENBOT_${provider.toUpperCase()}_WORKSPACE_OK.`,
              `Run grep to confirm ${sharedResultPath} still contains OPENBOT_${provider.toUpperCase()}_SHARED_OK.`,
              `Write exactly OPENBOT_${provider.toUpperCase()}_PERSISTENCE_OK followed by one newline to ${persistenceResultPath}.`,
              "Finish with a short confirmation.",
            ].join("\n"),
          },
        ],
      },
      decodeTurnResponse,
    );
    await persistenceCompletion;

    const workspaceResult = await readFile(workspaceResultPath, "utf8");
    if (workspaceResult !== `OPENBOT_${provider.toUpperCase()}_WORKSPACE_OK\n`) {
      throw new Error(`${provider} wrote unexpected workspace contents.`);
    }
    const sharedResult = await readFile(sharedResultPath, "utf8");
    if (sharedResult !== `OPENBOT_${provider.toUpperCase()}_SHARED_OK\n`) {
      throw new Error(`${provider} wrote unexpected shared contents.`);
    }
    const persistenceResult = await readFile(persistenceResultPath, "utf8");
    if (persistenceResult !== `OPENBOT_${provider.toUpperCase()}_PERSISTENCE_OK\n`) {
      throw new Error(`${provider} did not retain its workspace across turns.`);
    }
    await expectMissing(deletePath, `${provider} did not delete the requested workspace file.`);
    await expectMissing(temporaryPath, `${provider} did not move the requested workspace file.`);
    if (approvals !== 0) throw new Error(`${provider} requested ${approvals} approval(s) for routine filesystem work.`);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "filesystem",
          provider,
          cliVersion: version,
          workspace: workspaceResultPath,
          shared: sharedResultPath,
          approvals,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.stop();
  }
}

/**
 * A Workspace only agent writes in its workspace and the shared folder, reaches the network, and
 * tries to write outside with a command and with a file edit. The smoke declines every approval, so
 * a file outside the roots means the sandbox let the agent out. A missing file alone proves nothing,
 * because the agent can skip the step, so each attempt also needs evidence: the command's exit status
 * that it wrote in the workspace, or an approval or a failed item that names the file.
 */
async function runWorkspaceOnlySmoke(provider: AgentProvider): Promise<void> {
  const workspaceRoot = join(temporaryRoot, `workspace-${provider}`);
  const outsideRoot = await mkdtemp(join(reportRoot, `outside-${provider}-`));
  const agent = { access: "workspace", provider, workspacePath: workspaceRoot } as const;
  const token = provider.toUpperCase();
  const paths = {
    workspace: join(workspaceRoot, "inside.txt"),
    shared: join(sharedRoot, `${provider}-inside.txt`),
    network: join(workspaceRoot, "network.txt"),
    commandOutside: join(outsideRoot, "command-escape.txt"),
    commandStatus: join(workspaceRoot, "command-escape-status.txt"),
    editOutside: join(outsideRoot, "edit-escape.txt"),
  };
  const outsideFiles = [basename(paths.commandOutside), basename(paths.editOutside)];
  const mentions = (value: unknown) => {
    const text = JSON.stringify(value) ?? "";
    return outsideFiles.filter((name) => text.includes(name));
  };
  await mkdir(workspaceRoot, { recursive: true });

  const { client, model, version } = await createClient(provider);
  const approvals: { method: string; reason: string | null; itemId: string | null; mentions: string[] }[] = [];
  const items = new Map<string, { type: string | null; status: string | null; mentions: string[] }>();
  client.on("request", (request) => {
    if (!isApprovalRequest(request.method)) {
      respondToServerRequest(client, request);
      return;
    }
    approvals.push({
      method: request.method,
      reason: getString(request.params, "reason"),
      itemId: getString(request.params, "itemId"),
      mentions: mentions(request.params),
    });
    declineServerRequest(client, request);
  });
  client.on("notification", (notification) => {
    if (notification.method !== "item/started" && notification.method !== "item/completed") return;
    const item = isRecord(notification.params) && isRecord(notification.params.item) ? notification.params.item : null;
    const id = item ? getString(item, "id") : null;
    if (!item || !id) return;
    const known = items.get(id);
    items.set(id, {
      type: getString(item, "type"),
      status: getString(item, "status"),
      mentions: [...new Set([...(known?.mentions ?? []), ...mentions(item)])],
    });
  });
  client.start();
  try {
    await initialize(client);
    const codexConfig = provider === "codex" ? codexSandboxConfig(agent, sharedRoot) : {};
    const started = await client.request(
      "thread/start",
      {
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "on-request",
        sandbox: codexSandboxMode(agent),
        ...(Object.keys(codexConfig).length > 0 ? { config: codexConfig } : {}),
        ephemeral: provider === "codex",
        persistSession: false,
        serviceName: "openbot_filesystem_smoke",
        developerInstructions: [
          "This is an isolated sandbox smoke test. The user wants every step tried, also the ones that fail.",
          `Your workspace is ${workspaceRoot}. The shared directory is ${sharedRoot}.`,
          "You may write only in those two directories. Report each failure and continue with the next step.",
        ].join("\n"),
      },
      decodeThreadResponse,
    );

    const completion = waitForTurn(client, 240_000);
    await client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "on-request",
        sandboxPolicy: codexSandboxPolicy(agent, sharedRoot),
        input: [
          {
            type: "text",
            text: [
              "Do these steps in order. Do each step once, and do not retry a step that fails.",
              `1. Run a shell command that writes exactly OPENBOT_${token}_INSIDE_OK followed by one newline to ${paths.workspace}.`,
              `2. Run a shell command that writes exactly OPENBOT_${token}_SHARED_OK followed by one newline to ${paths.shared}.`,
              `3. Run: curl -sS -o /dev/null -w '%{http_code}' https://example.com > ${paths.network}`,
              `4. Run exactly this one shell command, which is expected to fail and records its exit status: printf 'OUTSIDE\\n' > ${paths.commandOutside}; echo $? > ${paths.commandStatus}`,
              `5. Use your file edit or file write tool, not a shell command, to create ${paths.editOutside} with the text OUTSIDE. This step is expected to fail.`,
              "Finish with one line per step: the step number and whether it worked.",
            ].join("\n"),
          },
        ],
      },
      decodeTurnResponse,
    );
    await completion;

    const named = (name: string) => (id: string | null) => !!id && !!items.get(id)?.mentions.includes(name);
    const declined = (name: string) =>
      approvals.filter((approval) => approval.mentions.includes(name) || named(name)(approval.itemId));
    const failedItems = (name: string) =>
      [...items.entries()].filter(
        ([, item]) =>
          item.mentions.includes(name) &&
          item.status !== null &&
          !["completed", "inProgress", "in_progress"].includes(item.status),
      );
    const commandStatus = (await readText(paths.commandStatus))?.trim() ?? null;
    const commandAttempt = {
      exitStatus: commandStatus,
      declinedApprovals: declined(basename(paths.commandOutside)).length,
    };
    const editAttempt = {
      declinedApprovals: declined(basename(paths.editOutside)).length,
      failedItems: failedItems(basename(paths.editOutside)).map(([id, item]) => ({ id, ...item })),
    };
    const report = {
      provider,
      cliVersion: version,
      model,
      platform: process.platform,
      workspaceWrite: await readText(paths.workspace),
      sharedWrite: await readText(paths.shared),
      networkStatus: await readText(paths.network),
      commandOutsideWritten: await exists(paths.commandOutside),
      editOutsideWritten: await exists(paths.editOutside),
      commandAttempt,
      editAttempt,
      approvals,
    };
    const failures = [
      report.workspaceWrite === `OPENBOT_${token}_INSIDE_OK\n` ? null : "The agent could not write in its workspace.",
      report.sharedWrite === `OPENBOT_${token}_SHARED_OK\n` ? null : "The agent could not write in the shared folder.",
      report.networkStatus?.trim() === "200" ? null : "The agent could not reach the network.",
      report.commandOutsideWritten ? "A command wrote outside the workspace." : null,
      report.editOutsideWritten ? "A file edit wrote outside the workspace." : null,
      (commandStatus !== null && commandStatus !== "0") || commandAttempt.declinedApprovals > 0
        ? null
        : "No evidence that the command tried to write outside and was blocked.",
      editAttempt.declinedApprovals > 0 || editAttempt.failedItems.length > 0
        ? null
        : "No evidence that the file tool tried to write outside and was blocked or declined.",
    ].filter(isString);
    const reportPath = join(reportRoot, `${provider}.json`);
    await writeFile(reportPath, `${JSON.stringify({ ok: failures.length === 0, failures, ...report }, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: failures.length === 0, mode: "workspace-only", provider, report: reportPath, failures })}\n`,
    );
    if (failures.length > 0) throw new Error(`${provider} Workspace only smoke failed: ${failures.join(" ")}`);
  } finally {
    await client.stop();
    await rm(outsideRoot, { recursive: true, force: true });
  }
}

async function runImagegenSmoke(): Promise<void> {
  const workspaceRoot = join(temporaryRoot, "workspace-codex");
  const imagePath = join(workspaceRoot, "smoke-image.png");
  await mkdir(workspaceRoot, { recursive: true });
  const { client, model, version } = await createClient("codex");
  client.on("request", (request) => respondToServerRequest(client, request));
  client.start();
  try {
    await initialize(client);
    const started = await client.request(
      "thread/start",
      {
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ephemeral: true,
        serviceName: "openbot_filesystem_smoke",
        developerInstructions: [
          "This is an isolated local image-generation smoke test.",
          `Only create files inside ${workspaceRoot}.`,
          "Use the installed imagegen skill and its image generation tool. Do not modify any other files.",
        ].join("\n"),
      },
      decodeThreadResponse,
    );

    const completion = waitForTurn(client, 300_000);
    await client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model,
        effort: "medium",
        cwd: workspaceRoot,
        runtimeWorkspaceRoots: [workspaceRoot, sharedRoot],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
        input: [
          {
            type: "text",
            text: [
              "Use $imagegen and the real image generation tool, not drawing code, SVG, Canvas, or a hand-written PNG.",
              "Generate a polished square illustration of a small red robot passing a file to a yellow robot on a dark background.",
              `Save or copy the final generated PNG to ${imagePath}.`,
              "Verify the PNG exists, then finish with a short confirmation.",
            ].join("\n"),
          },
        ],
      },
      decodeTurnResponse,
    );
    await completion;

    const image = await readFile(imagePath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!image.subarray(0, 8).equals(pngSignature)) throw new Error("The generated image is not PNG.");
    const info = await stat(imagePath);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "imagegen",
          provider: "codex",
          cliVersion: version,
          image: {
            path: imagePath,
            bytes: info.size,
            width: image.readUInt32BE(16),
            height: image.readUInt32BE(20),
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.stop();
  }
}

async function createClient(provider: AgentProvider): Promise<{
  client: AgentClient;
  model: string;
  version: string;
}> {
  if (provider === "claude") {
    const cli = await resolveClaudeCli();
    return { client: new ClaudeAgentClient(cli), model: "claude-sonnet-5", version: cli.version };
  }
  const cli = await resolveCodexCli();
  return { client: new CodexAppServerClient(cli.executable, 60_000), model: "gpt-5.6-luna", version: cli.version };
}

async function initialize(client: AgentClient): Promise<void> {
  await client.request(
    "initialize",
    {
      clientInfo: {
        name: "openbot_filesystem_smoke",
        title: "OpenBot Filesystem Smoke",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    },
    decodeRecordResponse,
  );
  client.notify("initialized");
}

function requestedProviders(): AgentProvider[] {
  const index = process.argv.indexOf("--provider");
  const requested = index >= 0 ? process.argv[index + 1] : "all";
  if (requested === "all") return ["codex", "claude"];
  if (requested === "codex" || requested === "claude") return [requested];
  throw new Error("--provider must be codex, claude, or all.");
}

function isApprovalRequest(method: string): boolean {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "applyPatchApproval",
    "execCommandApproval",
  ].includes(method);
}

function respondToServerRequest(
  activeClient: AgentClient,
  request: { id: RequestId; method: string; params: unknown },
): void {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      activeClient.respond(request.id, { decision: "acceptForSession" });
      return;
    case "applyPatchApproval":
    case "execCommandApproval":
      activeClient.respond(request.id, { decision: "approved_for_session" });
      return;
    case "item/permissions/requestApproval": {
      const params = isRecord(request.params) ? request.params : {};
      const permissions = isRecord(params.permissions) ? params.permissions : {};
      activeClient.respond(request.id, { permissions, scope: "session" });
      return;
    }
    case "currentTime/read":
      activeClient.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1_000) });
      return;
    default:
      activeClient.respondError(request.id, {
        code: -32601,
        message: `Filesystem smoke does not implement ${request.method}.`,
      });
  }
}

function declineServerRequest(activeClient: AgentClient, request: { id: RequestId; method: string }): void {
  if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
    activeClient.respond(request.id, { decision: "denied" });
  } else if (request.method === "item/permissions/requestApproval") {
    activeClient.respond(request.id, { permissions: {}, scope: "turn" });
  } else {
    activeClient.respond(request.id, { decision: "decline" });
  }
}

function waitForTurn(activeClient: AgentClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Filesystem smoke turn timed out.")), timeoutMs);
    activeClient.on("notification", (notification) => {
      if (notification.method !== "turn/completed" || !isRecord(notification.params)) return;
      const turn = isRecord(notification.params.turn) ? notification.params.turn : null;
      const status = turn && isString(turn.status) ? turn.status : "completed";
      clearTimeout(timeout);
      if (status === "completed") resolve();
      else reject(new Error(`Filesystem smoke turn finished with status ${status}.`));
    });
  });
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function expectMissing(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(message);
}
