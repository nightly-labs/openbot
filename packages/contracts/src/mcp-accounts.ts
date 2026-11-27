import type { McpServerConfig } from "./ipc-mcp-servers";

const MCP_ACCOUNT_FRAGMENT = /^#account-[A-Za-z0-9-]{1,64}$/;

export function mcpAccountFragment(url: string): string | null {
  const index = url.indexOf("#");
  if (index < 0) return null;
  const fragment = url.slice(index).trim();
  return MCP_ACCOUNT_FRAGMENT.test(fragment) ? fragment : null;
}

export function withoutMcpAccountFragment(url: string): string {
  return mcpAccountFragment(url) === null ? url : url.slice(0, url.indexOf("#"));
}

export function mcpAccountUrl(url: string, id: string): string {
  const fragment = `#account-${id}`;
  if (!MCP_ACCOUNT_FRAGMENT.test(fragment)) throw new Error("An MCP account id has only letters, digits and dashes.");
  const start = url.indexOf("#");
  return `${start < 0 ? url : url.slice(0, start)}${fragment}`;
}

export function sameSignInAddress(a: string, b: string): boolean {
  if (!URL.canParse(a.trim()) || !URL.canParse(b.trim())) return false;
  if (mcpAccountFragment(a) !== mcpAccountFragment(b)) return false;
  const [first, second] = [new URL(a.trim()), new URL(b.trim())];
  first.hash = "";
  second.hash = "";
  return first.href === second.href;
}

export function withOwnMcpAccount(
  config: McpServerConfig,
  others: readonly McpServerConfig[],
  accountId: string,
): McpServerConfig {
  if (config.transport !== "http") return config;
  const shared = others.some((row) => row.transport === "http" && sameSignInAddress(row.url, config.url));
  return shared ? { ...config, url: mcpAccountUrl(config.url, accountId) } : config;
}
