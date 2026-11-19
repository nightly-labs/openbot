import { DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { spentUsageWindow, usageTone } from "@openbot/team-client/plan-limits";
import { accountUsageProviderRows, formatUsageReset } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";

export function usePlanLimitRows() {
  const text = useText();
  const auth = useAuth();
  const { agentStatus, hostAccountLimits, agentList, modelOptions } = useAgents();
  const { usageLimits, usageLimitedModels } = useTurns();
  return createMemo(() => {
    const usage = withHostAccountUsage(auth.accountUsage(), hostAccountLimits());
    const rows = accountUsageProviderRows(usage, agentStatus().providers, text);
    const now = Date.now();
    const held = usageLimitedModels().filter((limit) => {
      const account = limit.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
      const spent = spentUsageWindow(usage?.limits, limit.provider, account, limit.model, now);
      const ownWindow = usage?.limits.some(
        (reading) => reading.primary === spent?.window || reading.secondary === spent?.window,
      );
      return !(spent?.covers && !spent.onCredits && ownWindow);
    });
    if (held.length === 0) return rows;
    const limits = usageLimits();
    return rows.map((row) => {
      const account = row.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
      const windows = held
        .filter(
          (limit) =>
            limit.provider === row.provider && (limit.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === account,
        )
        .map((limit) => {
          const agent = agentList().find(
            (candidate) =>
              candidate.id in limits &&
              candidate.provider === limit.provider &&
              candidate.model === limit.model &&
              (candidate.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === account,
          );
          const resetsAt = agent ? (limits[agent.id] ?? null) : null;
          return {
            label:
              modelOptions().find((option) => option.provider === limit.provider && option.id === limit.model)?.name ??
              limit.model,
            remainingPercent: 0,
            tone: usageTone(0),
            durationMins: null,
            resetsAt,
            resetsAtLabel: formatUsageReset(resetsAt, text),
          };
        });
      return windows.length
        ? {
            ...row,
            windows: [...row.windows, ...windows],
            ringWindows: windows,
            remainingPercent: 0,
            tone: usageTone(0),
          }
        : row;
    });
  });
}
