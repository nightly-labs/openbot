import type { CreditServerRole, CreditsState } from "@openbot/contracts/credits";
import type { AppTextKey } from "@openbot/i18n";
import { ChevronsUpDown, ServerPlushLogo, UserRound } from "@openbot/ui";
import { SearchPicker } from "@openbot/ui/components/SearchPicker";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { cx } from "../../utils";
import { CreditAmount } from "./CreditIcon";

export interface CreditTarget {
  serverId: string | null;
  name: string;
  role: CreditServerRole | null;
  balance: number;
}

const ROLE_LABEL = {
  owner: "billing.credits.role.owner",
  admin: "billing.credits.role.admin",
  member: "billing.credits.role.member",
} as const satisfies Record<CreditServerRole, AppTextKey>;

export function creditTargets(credits: CreditsState | null, youName: string): CreditTarget[] {
  if (!credits) return [];
  return [
    { serverId: null, name: youName, role: null, balance: credits.balance },
    ...credits.servers.map((server) => ({
      serverId: server.serverId,
      name: server.name,
      role: server.role,
      balance: server.balance,
    })),
  ];
}

function targetKey(target: CreditTarget): string {
  return target.serverId ?? "personal";
}

export function CreditTargetLogo(props: { target: CreditTarget; class?: string | undefined }): JSX.Element {
  return (
    <Show
      when={props.target.serverId}
      fallback={<UserRound class={cx("credit-target-logo", props.class)} aria-hidden="true" />}
    >
      {(serverId) => <ServerPlushLogo class={cx("credit-target-logo", props.class)} seed={serverId()} />}
    </Show>
  );
}

function TargetRole(props: { target: CreditTarget }) {
  const { t } = useText();
  const role = () => {
    const value = props.target.role;
    if (value === null) return t("billing.credits.personal");
    return t(ROLE_LABEL[value]);
  };
  return <span class="credit-picker-role">{role()}</span>;
}

export function CreditTargetSelect(props: {
  targets: CreditTarget[];
  value: CreditTarget;
  onChange: (target: CreditTarget) => void;
}): JSX.Element {
  const { t } = useText();
  return (
    <div class="credit-corner">
      <span class="credit-corner-for" aria-hidden="true">
        {t("billing.credits.for")}
      </span>
      <SearchPicker<CreditTarget>
        options={props.targets}
        optionKey={targetKey}
        optionName={(target) => target.name}
        value={targetKey(props.value)}
        onChange={props.onChange}
        label={t("billing.credits.forLabel")}
        searchLabel={t("billing.credits.searchTargets")}
        emptyText={(query) => t("billing.credits.noTarget", { query })}
        leading={(target) => <CreditTargetLogo target={target} class="credit-picker-logo" />}
        trailing={(target) => (
          <>
            <TargetRole target={target} />
            <CreditAmount credits={target.balance} class="credit-picker-balance" />
          </>
        )}
        align="end"
        menuClass="credit-picker-menu"
        currentCheck={false}
        triggerClass="credit-corner-select"
        triggerLabel={t("billing.credits.forLabel")}
      >
        <span class="credit-corner-value">
          <CreditTargetLogo target={props.value} />
          <span class="credit-corner-name">{props.value.name}</span>
          <CreditAmount credits={props.value.balance} class="credit-corner-balance" />
        </span>
        <ChevronsUpDown class="credit-corner-chevron" aria-hidden="true" />
      </SearchPicker>
    </div>
  );
}
