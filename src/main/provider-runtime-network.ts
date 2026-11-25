import { net } from "electron";

/**
 * The network access that a managed provider CLI download uses.
 *
 * Chromium's network stack follows the system proxy and falls back between IPv6 and IPv4.
 * Node's global `fetch` does neither.
 */
export type ProviderRuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const HTTPS_ONLY_MESSAGE = "Managed provider downloads require an https URL.";

function requireHttps(input: string | URL | Request): void {
  const value = input instanceof Request ? input.url : input;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(HTTPS_ONLY_MESSAGE);
  }
  if (url.protocol !== "https:") throw new Error(HTTPS_ONLY_MESSAGE);
}

/** Use Electron's `net.fetch` for managed provider CLI downloads. */
export const providerRuntimeFetch: ProviderRuntimeFetch = async (input, init) => {
  requireHttps(input);
  return net.fetch(input instanceof URL ? input.href : input, init);
};
