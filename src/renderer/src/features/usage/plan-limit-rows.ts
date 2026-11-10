import { DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { usageTone } from "@openbot/team-client/plan-limits";
import { accountUsageProviderRows, formatUsageReset } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";

/**
 * One row per provider account of the active server, for the rail rings. A model that the plan
 * refused adds a used-up line with its own name to its account, and the ring shows it: a limit of one
 * model, such as a separate weekly limit, is not in the account's 5-hour and weekly windows, which
 * then show usage left.
 */
export function usePlanLimitRows() {
  const text = useText();
  const auth = useAuth();
  const { agentStatus, hostAccountLimits, agentList, modelOptions } = useAgents();
  const { usageLimits, usageLimitedModels } = useTurns();
  return createMemo(() => {
    const rows = accountUsageProviderRows(
      withHostAccountUsage(auth.accountUsage(), hostAccountLimits()),
      agentStatus().providers,
      text,
    );
    const held = usageLimitedModels();
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
          // The reset is the one of an agent that the limit holds.
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
            resetsAt,
            resetsAtLabel: formatUsageReset(resetsAt, text),
          };
        });
      // The used-up model stops work first, so the ring and the chip show it, as for a used-up Cursor window.
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
