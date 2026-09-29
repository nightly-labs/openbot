import {
  type HostedServerCheckout,
  type HostedServerSummary,
  parseHostedServerCatalog,
  parseHostedServerCheckout,
  parseHostedServerList,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { currentText } from "@openbot/ui/text";
import type { AddServerResume } from "../servers/AddServerOverlay";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The hosted server calls for a signed-in browser: the add server dialog and the server list in
 * Billing. They use the `/api/browser/v2/hosting/...` operations. The page goes only to a Stripe
 * Checkout URL, which the contract parser checks.
 */
export function createWebHostedServerCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): HostedServersDesktopApi {
  async function send(
    path: string,
    init: { method?: "POST" | "DELETE"; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const post = init.body !== undefined;
    const response = await accountFetch(`/api/browser/v2/hosting/${path}`, {
      method: init.method ?? (post ? "POST" : "GET"),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: post ? { "Content-Type": "application/json", "X-OpenBot-Browser": "1", ...init.headers } : {},
      ...(post ? { body: init.body } : {}),
    }).catch(() => {
      throw new Error(errorMessage(null));
    });
    if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
    return response;
  }

  async function request<T>(
    path: string,
    decode: (value: unknown) => T | null,
    init: { body?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const value = await (await send(path, init)).json().catch(() => null);
    const decoded = decode(value);
    if (!decoded) throw new Error(currentText().sourceText("error.auth.invalidHostedServer"));
    return decoded;
  }

  /** Goes to the payment page, when the server has one. The page leaves the app. */
  function open(checkout: HostedServerCheckout): HostedServerSummary {
    if (checkout.checkoutUrl) navigate(checkout.checkoutUrl);
    return checkout.server;
  }

  const serverPath = (serverId: string, action: string) => `servers/${encodeURIComponent(serverId)}/${action}`;

  return {
    list: () => request("servers", parseHostedServerList),
    plans: () => request("plans", parseHostedServerCatalog),
    async create({ requestId, ...input }) {
      const body = JSON.stringify(input);
      return open(
        await request("servers", parseHostedServerCheckout, { body, headers: { "Idempotency-Key": requestId } }),
      );
    },
    openCheckout: async (serverId) =>
      open(await request(serverPath(serverId, "checkout"), parseHostedServerCheckout, { body: "{}" })),
    wake: (serverId) => request(serverPath(serverId, "wake"), parseHostedServerSummary, { body: "{}" }),
    async delete({ serverId, confirmName }) {
      await send(`servers/${encodeURIComponent(serverId)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName }),
      });
    },
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message))
    return value.error.message;
  return currentText().t("webClient.error.requestFailed");
}

/**
 * Stripe Checkout returns to `/app?hosting=checkout&hosted_server=<id>`, with `&cancelled=1` when the user
 * went back. The server field is not `server`: an invitation link uses that name, and its reader removes it first.
 */
const WEB_APP_HOSTING_PARAM = "hosting";
const WEB_APP_HOSTED_SERVER_PARAM = "hosted_server";

/** The server of a return from Stripe Checkout. The query is removed after it is read. */
export function takeHostingReturn(): AddServerResume | null {
  const url = new URL(window.location.href);
  if (url.searchParams.get(WEB_APP_HOSTING_PARAM) !== "checkout") return null;
  const serverId = url.searchParams.get(WEB_APP_HOSTED_SERVER_PARAM);
  const paid = url.searchParams.get("cancelled") !== "1";
  for (const name of [WEB_APP_HOSTING_PARAM, WEB_APP_HOSTED_SERVER_PARAM, "cancelled"]) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
  return serverId ? { serverId, paid } : null;
}
