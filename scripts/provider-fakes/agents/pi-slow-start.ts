// The Pi of `pi-slow-start-e2e.ts`, on Pi's JSONL RPC. It reads no command for `FAKE_START_DELAY_MS`,
// as a Pi that starts slowly on a busy computer. With `FAKE_HANG=1`, it never answers. It lists one
// OpenRouter model. `pi update --models` ends at once.
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

if (process.argv.includes("update")) process.exit(0);

function answer(command: RpcRecord, data: RpcRecord = {}): void {
  process.stdout.write(
    `${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`,
  );
}

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { isStreaming: false, isCompacting: false }),
  get_available_models: (command) =>
    answer(command, { models: [{ provider: "openrouter", id: "fake/slow-start", name: "Slow start" }] }),
};

const ready = new Promise<void>((resolve) => setTimeout(resolve, Number(process.env.FAKE_START_DELAY_MS ?? 0)));
process.on("SIGTERM", () => process.exit(0));
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const command = line.trim() ? JSON.parse(line) : null;
    if (!isDynamicRecord(command) || process.env.FAKE_HANG === "1") return;
    const handler = handlers[String(command.type)];
    if (handler) void ready.then(() => handler(command));
  })
  .on("close", () => process.exit(0));
