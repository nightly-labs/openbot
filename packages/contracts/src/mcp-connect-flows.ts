import type { McpKeyValue, McpServerConfig } from "./ipc";

export interface McpAuthField {
  id: string;
  label: string;
  url?: boolean;
  header?: string;
  env?: string;
  prefix?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

interface McpConnectFlowBase {
  id: string;
  label: string;
}

export interface McpLinkFlow extends McpConnectFlowBase {
  kind: "link";
}

export interface McpKeyFlow extends McpConnectFlowBase {
  kind: "key";
  fields: McpAuthField[];
  docsUrl?: string | null;
  docsLabel?: string;
}

export interface McpLocalFlow extends McpConnectFlowBase {
  kind: "local";
  steps: string[];
  note?: string;
  docsUrl?: string | null;
  docsLabel?: string;
}

export type McpConnectFlow = McpLinkFlow | McpKeyFlow | McpLocalFlow;

export type McpAuth = McpConnectFlow[];

export type McpAuthValues = Record<string, string>;

export function mcpFlowComplete(flow: McpConnectFlow | null | undefined, values: McpAuthValues): boolean {
  return mcpFlowFields(flow).every((field) => field.optional || (values[field.id] ?? "").trim().length > 0);
}

export function isListingUrl(value: string, listingUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = new URL(listingUrl).hostname;
  return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function mcpFlowFields(flow: McpConnectFlow | null | undefined): McpAuthField[] {
  return flow?.kind === "key" ? flow.fields : [];
}

export function applyMcpFlow(
  config: McpServerConfig,
  flow: McpConnectFlow | null | undefined,
  values: McpAuthValues,
): McpServerConfig {
  const stdio = config.transport === "stdio";
  const link = mcpFlowFields(flow)
    .filter((field) => field.url)
    .map((field) => (values[field.id] ?? "").trim())
    .find(Boolean);
  const base = link && !stdio ? { ...config, url: link } : config;
  const written = mcpFlowFields(flow).flatMap((field) => {
    if (field.url) return [];
    const key = stdio ? field.env : field.header;
    const value = values[field.id] ?? "";
    return key && value ? [{ key, value: `${field.prefix ?? ""}${value}` }] : [];
  });
  const kept = (pairs: McpKeyValue[]) => pairs.filter((pair) => !written.some((wrote) => wrote.key === pair.key));
  return stdio
    ? { ...base, env: [...kept(base.env), ...written] }
    : { ...base, headers: [...kept(base.headers), ...written] };
}

export function savedKeyFlow(
  flows: readonly McpConnectFlow[] | null | undefined,
  config: McpServerConfig,
): McpKeyFlow | null {
  const stdio = config.transport === "stdio";
  const pairs = stdio ? config.env : config.headers;
  const holds = (field: McpAuthField) => {
    const key = stdio ? field.env : field.header;
    return Boolean(key) && pairs.some((pair) => pair.key === key);
  };
  return (flows ?? []).find((flow): flow is McpKeyFlow => flow.kind === "key" && flow.fields.some(holds)) ?? null;
}
