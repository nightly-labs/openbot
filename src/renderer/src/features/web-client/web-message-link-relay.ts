import {
  type McpSignInRelayPage,
  type McpTestResult,
  type OpenBotDesktopApi,
  relayableSignInLink,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { openWebLink } from "./web-attachments";
import { webMcpRelay } from "./web-mcp-relay";

export type WebMessageLinks = Pick<
  OpenBotDesktopApi["agent"],
  "openMessageLink" | "pasteMessageLink" | "cancelMessageLink"
>;

export function webMessageLinks(request: () => TeamApiRequest, enabled: () => boolean): WebMessageLinks {
  const shown = new Map<string, (page: McpSignInRelayPage | null) => void>();
  const running = new Map<string, Promise<McpTestResult>>();
  const relay = webMcpRelay((url, page) => {
    if (page) shown.get(url)?.(page);
  });

  return {
    openMessageLink: async ({ agentId, url }) => {
      await openWebLink(url);
      const page = relayableSignInLink(url);
      if (!page || !enabled()) return null;
      relay.cancel(page);
      const done = relay.signInLink(request(), agentId, page);
      running.set(page, done);
      const forget = () => {
        if (running.get(page) === done) running.delete(page);
      };
      done.then(forget, forget);
      let show: (view: McpSignInRelayPage | Error | null) => void = () => undefined;
      const view = await new Promise<McpSignInRelayPage | Error | null>((resolve) => {
        show = resolve;
        shown.set(page, resolve);
        done.then(
          (result) => resolve(result.error === null ? null : new Error(result.error)),
          () => resolve(null),
        );
      });
      if (shown.get(page) === show) shown.delete(page);
      if (view instanceof Error) throw view;
      return view;
    },
    pasteMessageLink: async ({ url, address }) => {
      const page = relayableSignInLink(url);
      const done = page ? running.get(page) : undefined;
      if (!page || !done) throw new Error(sourceText("error.mcp.relayEnded"));
      await relay.paste(page, address);
      const result = await done;
      if (result.error !== null) throw new Error(result.error);
    },
    cancelMessageLink: async ({ url }) => {
      const page = relayableSignInLink(url);
      if (page) relay.cancel(page);
    },
  };
}
