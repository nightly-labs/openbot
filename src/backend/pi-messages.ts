import { readFile } from "node:fs/promises";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { getArray, getString, isRecord, type ThreadItem } from "./protocol";
import { providerCall, providerFailure } from "./provider-client-effects";

export function piText(content: unknown): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && isString(block.text) ? [block.text] : []))
    .join("\n");
}

/** Converts the authoritative Pi message, never a cumulative streaming snapshot. */
export function piMessageItems(message: unknown, id: string): ThreadItem[] {
  const role = getString(message, "role");
  if (role === "user")
    return [
      {
        id,
        type: "userMessage",
        content: [{ type: "text", text: piText(isRecord(message) ? message.content : null) }],
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
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && isString(block.text))
      items.push({
        id: `${id}:text:${index}`,
        type: "agentMessage",
        text: block.text,
        phase: getString(message, "stopReason") === "toolUse" ? "commentary" : "final_answer",
      });
    if (block.type === "thinking" && isString(block.thinking))
      items.push({
        id: `${id}:thinking:${index}`,
        type: "reasoning",
        text: block.thinking,
        summary: [{ type: "summary_text", text: block.thinking }],
      });
    if (block.type === "toolCall")
      items.push({
        id: getString(block, "id") ?? `${id}:tool:${index}`,
        type: "dynamicToolCall",
        tool: getString(block, "name"),
        arguments: block.arguments,
        status: "inProgress",
      });
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
      const mimeType = path.toLowerCase().endsWith(".png")
        ? "image/png"
        : path.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : path.toLowerCase().endsWith(".gif")
            ? "image/gif"
            : "image/jpeg";
      images.push({ type: "image", mimeType, data: bytes.toString("base64") });
    }
  }
  return { message: texts.join("\n"), ...(images.length ? { images } : {}) };
});
