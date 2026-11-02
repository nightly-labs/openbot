/**
 * More than one account on one MCP server (#3753). Each account is its own http row, and a row that
 * the user added as another account has the listing URL with an `#account-<id>` fragment. The host
 * files the sign-in of such a row under the URL with its fragment, so each account has its own
 * tokens. The fragment never leaves the computer: `fetch` does not send it, and the host removes it
 * before a provider or an OAuth request gets the URL.
 */

const MCP_ACCOUNT_FRAGMENT = /^#account-[A-Za-z0-9-]{1,64}$/;

/** The `#account-…` fragment of a row URL, or `null` when the row is not an added account. */
export function mcpAccountFragment(url: string): string | null {
  const index = url.indexOf("#");
  if (index < 0) return null;
  const fragment = url.slice(index).trim();
  return MCP_ACCOUNT_FRAGMENT.test(fragment) ? fragment : null;
}

/** A row URL without its account fragment: the address that the server and a provider get. */
export function withoutMcpAccountFragment(url: string): string {
  return mcpAccountFragment(url) === null ? url : url.slice(0, url.indexOf("#"));
}

/** The URL of a new account row on `url`. `id` is a random value that names no person. */
export function mcpAccountUrl(url: string, id: string): string {
  const fragment = `#account-${id}`;
  if (!MCP_ACCOUNT_FRAGMENT.test(fragment)) throw new Error("An MCP account id has only letters, digits and dashes.");
  return `${withoutMcpAccountFragment(url)}${fragment}`;
}
