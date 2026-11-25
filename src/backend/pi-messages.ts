import { readFile } from "node:fs/promises";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { withoutTurnContext } from "./agent/developer-instructions";
import { getArray, getString, isRecord, type ThreadItem } from "./protocol";
import { providerCall, providerFailure } from "./provider-client-effects";

export function piText(content: unknown): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && isString(block.text) ? [block.text] : []))
    .join("\n");
}

const PI_SHELL_TOOLS = new Set(["bash", "powershell"]);

export function piShellCommand(tool: string | null, args: unknown): { command?: string } {
  const command = tool !== null && PI_SHELL_TOOLS.has(tool) ? getString(args, "command") : null;
  return command ? { command: command.slice(0, INPUT_LIMITS.messageText) } : {};
}

export function piMessageItems(message: unknown, id: string): ThreadItem[] {
  const role = getString(message, "role");
  if (role === "user")
    return [
      {
        id,
        type: "userMessage",
        content: [{ type: "text", text: withoutTurnContext(piText(isRecord(message) ? message.content : null)) }],
      },
    ];
  if (role === "toolResult")
    return [
      {
        id: getString(message, "toolCallId") ?? id,
        type: "dynamicToolCall",
        tool: getString(message, "toolName"),
        status: isRecord(message) && message.isError ? "failed" : "completed",
        contentItems: [{ type: "inputText", text: piText(isRecord(message) ? message.content : null) }],
      },
    ];
  if (role !== "assistant") return [];
  const items: ThreadItem[] = [];
  const content = getArray(message, "content");
  const step =
    getString(message, "stopReason") === "toolUse" ||
    content.some((block) => isRecord(block) && block.type === "toolCall");
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && isString(block.text))
      items.push({
        id: `${id}:text:${index}`,
        type: "agentMessage",
        text: block.text,
        phase: step ? "commentary" : "final_answer",
      });
    if (block.type === "thinking" && isString(block.thinking))
      items.push({
        id: `${id}:thinking:${index}`,
        type: "reasoning",
        text: block.thinking,
        summary: [block.thinking],
      });
    if (block.type === "toolCall") {
      const tool = getString(block, "name");
      items.push({
        id: getString(block, "id") ?? `${id}:tool:${index}`,
        type: "dynamicToolCall",
        tool,
        arguments: block.arguments,
        ...piShellCommand(tool, block.arguments),
        status: "inProgress",
      });
    }
  }
  return items;
}

export const piPrompt = Effect.fn("Pi.prompt")(function* (params: unknown) {
  const texts: string[] = [];
  const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const input of getArray(params, "input")) {
    if (!isRecord(input)) continue;
    if (input.type === "text" && isString(input.text)) texts.push(input.text);
    else if (input.type === "image") {
      const url = getString(input, "url") ?? getString(input, "imageUrl") ?? "";
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/u.exec(url);
      if (!match?.[1] || !match[2]) return yield* providerFailure(new Error("Pi requires an inline image."));
      images.push({ type: "image", mimeType: match[1], data: match[2] });
    } else if (input.type === "localImage") {
      const path = getString(input, "path");
      if (!path) return yield* providerFailure(new Error("Pi image has no path."));
      const bytes = yield* providerCall(() => readFile(path));
      const mimeType = attachmentMimeTypeForName(path);
      images.push({ type: "image", mimeType, data: bytes.toString("base64") });
    }
  }
  return { message: texts.join("\n"), ...(images.length ? { images } : {}) };
});
