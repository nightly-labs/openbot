import {
  type AccountUsage,
  type AgentModelChoice,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  usageQuotaForModel,
} from "@openbot/contracts/ipc";
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
 * then show usage left. When a spent window of the account's reading covers the model, that window
 * is the cause, and the reading shows it with its measured amount: the model gets no line (#10565).
 */
export function usePlanLimitRows() {
  const text = useText();
  const auth = useAuth();
  const { agentStatus, hostAccountLimits, agentList, modelOptions } = useAgents();
  const { usageLimits, usageLimitedModels } = useTurns();
  return createMemo(() => {
    const usage = withHostAccountUsage(auth.accountUsage(), hostAccountLimits());
    const rows = accountUsageProviderRows(usage, agentStatus().providers, text);
    const held = usageLimitedModels().filter((limit) => !spentInReading(usage, limit, Date.now() / 1_000));
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
            durationMins: null,
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

/**
 * Whether a spent window of the account's reading limits the model, as the gate reads it: a used-up
 * window whose reset has not passed. A reading past its reset is old, so it does not explain a refusal.
 */
function spentInReading(usage: AccountUsage | null, limit: AgentModelChoice, nowSeconds: number): boolean {
  const account = limit.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const reading = usage?.limits.find(
    (candidate) => candidate.id === limit.provider && (candidate.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === account,
  );
  const quota = reading && usageQuotaForModel(reading, limit.model);
  return [quota?.primary, quota?.secondary].some(
    (window) =>
      window != null && window.usedPercent >= 100 && (window.resetsAt === null || window.resetsAt > nowSeconds),
  );
}
