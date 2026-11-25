import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.2\n");
  process.exit(0);
}
if (process.argv.includes("update")) process.exit(0);

function answer(command: RpcRecord, data: RpcRecord = {}): void {
  process.stdout.write(
    `${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`,
  );
}

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { isStreaming: false, isCompacting: false }),
  get_available_models: (command) =>
    answer(command, {
      models: [{ provider: "openrouter", id: modelId(), name: "Slow start" }],
    }),
};

function modelId(): string {
  const file = process.env.FAKE_MODEL_FILE;
  return file ? readFileSync(file, "utf8").trim() : "fake/slow-start";
}

function gateOpen(): Promise<void> {
  const gate = process.env.FAKE_GATE_FILE;
  return new Promise((resolve) => {
    const check = () => (!gate || existsSync(gate) ? resolve() : setTimeout(check, 50));
    check();
  });
}

const ready = new Promise<void>((resolve) => setTimeout(resolve, Number(process.env.FAKE_START_DELAY_MS ?? 0)));
process.on("SIGTERM", () => process.exit(0));
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const command = line.trim() ? JSON.parse(line) : null;
    if (!isDynamicRecord(command) || process.env.FAKE_HANG === "1") return;
    const handler = handlers[String(command.type)];
    if (handler) void ready.then(gateOpen).then(() => handler(command));
  })
  .on("close", () => process.exit(0));
