import { net } from "electron";

/**
 * The network access that a managed provider CLI download uses.
 *
 * Chromium's network stack follows the system proxy and falls back between IPv6 and IPv4.
 * Node's global `fetch` does neither.
 */
export type ProviderRuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Use Electron's `net.fetch` for managed provider CLI downloads. */
export const providerRuntimeFetch: ProviderRuntimeFetch = (input, init) =>
  net.fetch(input instanceof URL ? input.href : input, init);
