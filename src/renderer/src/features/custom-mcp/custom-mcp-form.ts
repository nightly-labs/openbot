import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SaveCustomMcpInput } from "@openbot/contracts/ipc";
import {
  CUSTOM_MCP_ID_PATTERN,
  CUSTOM_MCP_LIMITS,
  CUSTOM_MCP_RESERVED_IDS,
  isCustomMcpNameToken,
} from "@openbot/contracts/ipc";

export interface CustomMcpPairDraft {
  name: string;
  value: string;
}

export interface CustomMcpDraft {
  serverId: string;
  displayName: string;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  env: CustomMcpPairDraft[];
  url: string;
  headers: CustomMcpPairDraft[];
}

export interface CustomMcpErrors {
  serverId?: string;
  displayName?: string;
  command?: string;
  args?: string;
  url?: string;
  envRows: (string | undefined)[];
  headerRows: (string | undefined)[];
}

export function emptyCustomMcpDraft(): CustomMcpDraft {
  return {
    serverId: "",
    displayName: "",
    transport: "stdio",
    command: "",
    argsText: "",
    env: [{ name: "", value: "" }],
    url: "",
    headers: [{ name: "", value: "" }],
  };
}

function blankPair(pair: CustomMcpPairDraft): boolean {
  return !pair.name.trim() && !pair.value.trim();
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function validatePairs(
  rows: readonly CustomMcpPairDraft[],
  kind: "environment variable" | "header",
  limit: number,
): { section?: string; rows: (string | undefined)[] } {
  const messages: (string | undefined)[] = rows.map(() => undefined);
  const filled = rows.filter((row) => !blankPair(row));
  if (filled.length > limit) {
    messages[limit] = `Add no more than ${limit} ${kind}s.`;
  }
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (blankPair(row)) return;
    const name = row.name.trim();
    if (!name) {
      messages[index] = `Enter a ${kind} name.`;
      return;
    }
    if (!isCustomMcpNameToken(name)) {
      messages[index] = `Use a valid ${kind} name.`;
      return;
    }
    if (seen.has(name.toLowerCase())) {
      messages[index] = `This server already sets ${name}.`;
      return;
    }
    if (!row.value.trim()) {
      messages[index] = `Enter a ${kind} value.`;
      return;
    }
    if (row.value.length > CUSTOM_MCP_LIMITS.secret) {
      messages[index] = `Keep the value under ${CUSTOM_MCP_LIMITS.secret} characters.`;
      return;
    }
    seen.add(name.toLowerCase());
  });
  return { rows: messages };
}

export function validateCustomMcp(draft: CustomMcpDraft, takenIds: readonly string[] = []): CustomMcpErrors {
  const serverId = draft.serverId.trim();
  const errors: CustomMcpErrors = {
    envRows: draft.env.map(() => undefined),
    headerRows: draft.headers.map(() => undefined),
  };

  if (!serverId) errors.serverId = "Enter a server ID.";
  else if (!CUSTOM_MCP_ID_PATTERN.test(serverId)) {
    errors.serverId = "Use lowercase letters, numbers, hyphens or underscores, starting with a letter or number.";
  } else if (serverId.length > INPUT_LIMITS.identifier) {
    errors.serverId = `Keep the server ID under ${INPUT_LIMITS.identifier} characters.`;
  } else if (CUSTOM_MCP_RESERVED_IDS.some((reserved) => reserved === serverId)) {
    errors.serverId = `OpenBot already uses ${serverId}. Choose another ID.`;
  } else if (takenIds.includes(serverId)) {
    errors.serverId = `A server called ${serverId} is already saved. Remove it first, or choose another ID.`;
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = "Enter a display name.";
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = `Keep the display name under ${INPUT_LIMITS.agentName} characters.`;
  }

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (!command) errors.command = "Enter a command.";
    else if (command.includes("\n")) errors.command = "The command must be an executable, not a shell line.";
    else if (command.length > CUSTOM_MCP_LIMITS.command) {
      errors.command = `Keep the command under ${CUSTOM_MCP_LIMITS.command} characters.`;
    }
    const args = draft.argsText
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (args.length > CUSTOM_MCP_LIMITS.args) {
      errors.args = `Add no more than ${CUSTOM_MCP_LIMITS.args} arguments.`;
    } else if (args.some((arg) => arg.length > CUSTOM_MCP_LIMITS.command)) {
      errors.args = `Keep each argument under ${CUSTOM_MCP_LIMITS.command} characters.`;
    }
    const env = validatePairs(draft.env, "environment variable", CUSTOM_MCP_LIMITS.env);
    errors.envRows = env.rows;
  } else {
    const url = draft.url.trim();
    if (!url) errors.url = "Enter a URL.";
    else if (url.length > CUSTOM_MCP_LIMITS.url) errors.url = `Keep the URL under ${CUSTOM_MCP_LIMITS.url} characters.`;
    else {
      const parsed = parseUrl(url);
      if (!parsed) errors.url = "Enter a full URL, such as https://mcp.example.com/mcp.";
      else if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        errors.url = "Use an http:// or https:// URL.";
      else if (parsed.username || parsed.password) errors.url = "Put the credential in a header, not in the URL.";
    }
    const headers = validatePairs(draft.headers, "header", CUSTOM_MCP_LIMITS.headers);
    errors.headerRows = headers.rows;
  }

  return errors;
}

export function hasCustomMcpError(errors: CustomMcpErrors): boolean {
  return Boolean(
    errors.serverId ||
      errors.displayName ||
      errors.command ||
      errors.args ||
      errors.url ||
      errors.envRows.some(Boolean) ||
      errors.headerRows.some(Boolean),
  );
}

export function customMcpValue(draft: CustomMcpDraft): SaveCustomMcpInput {
  const id = draft.serverId.trim();
  const name = draft.displayName.trim();
  if (draft.transport === "stdio") {
    return {
      id,
      name,
      transport: "stdio",
      command: draft.command.trim(),
      args: draft.argsText
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0),
      env: draft.env.filter((row) => !blankPair(row)).map((row) => ({ name: row.name.trim(), value: row.value })),
    };
  }
  return {
    id,
    name,
    transport: "http",
    url: draft.url.trim(),
    headers: draft.headers.filter((row) => !blankPair(row)).map((row) => ({ name: row.name.trim(), value: row.value })),
  };
}
