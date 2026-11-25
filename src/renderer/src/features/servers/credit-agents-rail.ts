import type { ServerSummary } from "@openbot/contracts/ipc";
import { MEDIA_APPROVAL_CHOICE_CAPABILITY } from "@openbot/contracts/team-protocol/media-approval-choice-v1";
import { MEDIA_APPROVAL_CREDITS_CAPABILITY } from "@openbot/contracts/team-protocol/media-approval-credits-v1";
import { useText } from "@openbot/ui/text";
import { createEffect } from "solid-js";
import { actionToast } from "../../action-toast";
import {
  type CreditAsksCalls,
  creditAsksMuted,
  type HostMediaApprovalCreditsCalls,
  loadCreditAsksMuted,
  loadMediaApprovalCredits,
  mediaApprovalCredits,
  saveCreditAsksMuted,
  saveMediaApprovalCredits,
} from "./media-approval-credits-store";
import { serverCanAdminister, serverSupportsCapability } from "./server-capabilities";

export function createCreditAgentsRail(options: {
  server: () => ServerSummary | undefined;
  shown: () => boolean;
  calls: HostMediaApprovalCreditsCalls;
  asks: CreditAsksCalls;
}) {
  const { t, errorMessage } = useText();
  const serverId = (): string | undefined => {
    const server = options.server();
    return options.shown() && serverCanAdminister(server, MEDIA_APPROVAL_CREDITS_CAPABILITY) ? server.id : undefined;
  };
  const memberServerId = (): string | undefined => {
    const server = options.server();
    if (!server || !options.shown() || serverId()) return undefined;
    return serverSupportsCapability(server, MEDIA_APPROVAL_CHOICE_CAPABILITY) ? server.id : undefined;
  };
  createEffect(serverId, (id) => {
    if (id) loadMediaApprovalCredits(id, options.calls).catch(() => undefined);
  });
  createEffect(memberServerId, (id) => {
    if (id) loadCreditAsksMuted(id, options.asks).catch(() => undefined);
  });
  const saveFailed = (error: unknown) => {
    actionToast.error(errorMessage(error, t("app.rail.creditsAgentsSaveFailed")));
  };
  const askSaveFailed = (error: unknown) => {
    actionToast.error(errorMessage(error, t("app.rail.creditsAskSaveFailed")));
  };
  const agents = (): boolean | undefined => {
    const id = serverId();
    return id ? mediaApprovalCredits(id)?.agents : undefined;
  };
  const change = (): ((agents: boolean) => void) | undefined => {
    const id = serverId();
    if (!id || agents() === undefined) return undefined;
    return (next) => {
      saveMediaApprovalCredits(id, { agents: next }, options.calls).catch(saveFailed);
    };
  };
  const ask = (): boolean | undefined => {
    const id = serverId();
    if (id) return mediaApprovalCredits(id)?.askWhenBlocked;
    const memberId = memberServerId();
    const muted = memberId ? creditAsksMuted(memberId) : undefined;
    return muted === undefined ? undefined : !muted;
  };
  const changeAsk = (): ((ask: boolean) => void) | undefined => {
    if (ask() === undefined) return undefined;
    const id = serverId();
    if (id)
      return (next) => {
        saveMediaApprovalCredits(id, { askWhenBlocked: next }, options.calls).catch(askSaveFailed);
      };
    const memberId = memberServerId();
    if (!memberId) return undefined;
    return (next) => {
      saveCreditAsksMuted(memberId, !next, options.asks).catch(askSaveFailed);
    };
  };
  return { agents, change, ask, changeAsk };
}
