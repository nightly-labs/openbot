import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isRecord } from "../../../src/backend/protocol";

const NL = "\n";
const realCli = process.env.REAL_KIRO_CLI ?? "";
const traceFile = process.env.TRACE_LOG ?? "";
const args = process.argv.slice(2);

function trace(entry: DynamicRecord): void {
  if (traceFile) appendFileSync(traceFile, `${JSON.stringify({ at: Date.now(), ...entry })}${NL}`);
}

function modelDescriptions(result: unknown): Record<string, string> | undefined {
  if (!isRecord(result) || !Array.isArray(result.configOptions)) return undefined;
  const model = result.configOptions.find((option) => isRecord(option) && option.id === "model");
  if (!isRecord(model) || !Array.isArray(model.options)) return undefined;
  return Object.fromEntries(
    model.options.flatMap((option) =>
      isRecord(option) && typeof option.value === "string" && typeof option.description === "string"
        ? [[option.value, option.description]]
        : [],
    ),
  );
}

function describe(direction: "to-agent" | "from-agent", line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(message)) return;
  const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
  const params = isRecord(message.params) ? message.params : {};
  const method = typeof message.method === "string" ? message.method : undefined;
  if (!method) {
    trace({ direction, id, response: true, failed: "error" in message, models: modelDescriptions(message.result) });
    return;
  }
  if (method === "session/set_config_option") {
    trace({ direction, method, id, configId: params.configId, value: params.value });
    return;
  }
  if (method === "session/update") {
    const update = isRecord(params.update) ? params.update : {};
    const kiro = isRecord(update._meta) && isRecord(update._meta.kiro) ? update._meta.kiro : {};
    trace({
      direction,
      method,
      sessionId: params.sessionId,
      update: update.sessionUpdate,
      kind: kiro.kind,
      ...(kiro.kind === "context_usage" && isRecord(kiro.contextUsage)
        ? { usagePercentage: kiro.contextUsage.usagePercentage }
        : {}),
      ...(kiro.kind === "turn_completion" ? { promptTurnSummaries: kiro.promptTurnSummaries } : {}),
    });
    return;
  }
  trace({ direction, method, id, sessionId: params.sessionId });
}

function forwardLines(
  source: NodeJS.ReadableStream,
  target: NodeJS.WritableStream,
  direction: "to-agent" | "from-agent",
): void {
  let buffer = "";
  source.setEncoding("utf8");
  source.on("data", (chunk: string) => {
    buffer += chunk;
    for (let index = buffer.indexOf(NL); index >= 0; index = buffer.indexOf(NL)) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) describe(direction, line);
    }
    target.write(chunk);
  });
}

if (args[0] !== "acp") {
  const child = spawn(realCli, args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  trace({ event: "start", argv: args });
  const child = spawn(realCli, args, { stdio: ["pipe", "pipe", "inherit"] });
  forwardLines(process.stdin, child.stdin, "to-agent");
  forwardLines(child.stdout, process.stdout, "from-agent");
  process.stdin.on("end", () => child.stdin.end());
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => {
    trace({ event: "exit", code, signal });
    process.exit(code ?? (signal ? 1 : 0));
  });
}
