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
  return `${withoutMcpAccountFragment(url)}${fragment}`;
}
