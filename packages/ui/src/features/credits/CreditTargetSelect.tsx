import type { CreditServerRole, CreditsState } from "@openbot/contracts/credits";
import type { AppTextKey } from "@openbot/i18n";
import { SearchSelect, ServerPlushLogo, UserRound } from "@openbot/ui";
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

function TargetOption(props: { target: CreditTarget }) {
  const { t, format } = useText();
  const role = () => {
    const value = props.target.role;
    if (value === null) return t("billing.credits.personal");
    return t(ROLE_LABEL[value]);
  };
  return (
    <span class="credit-option" data-personal={props.target.serverId === null ? "" : undefined}>
      <CreditTargetLogo target={props.target} />
      <span class="credit-option-who">
        <span class="credit-option-name">{props.target.name}</span>
        <span class="credit-option-role">{role()}</span>
      </span>
      <CreditAmount value={format.number(props.target.balance)} class="credit-option-balance" />
    </span>
  );
}

export function CreditTargetSelect(props: {
  targets: CreditTarget[];
  value: CreditTarget;
  onChange: (target: CreditTarget) => void;
}): JSX.Element {
  const { t, format } = useText();
  return (
    <div class="credit-corner">
      <span class="credit-corner-for" aria-hidden="true">
        {t("billing.credits.for")}
      </span>
      <SearchSelect<CreditTarget>
        class="credit-corner-select"
        size="sm"
        aria-label={t("billing.credits.forLabel")}
        placement="bottom-end"
        options={props.targets}
        value={props.value}
        label={(target) => target.name}
        optionValue={targetKey}
        itemContent={(target) => <TargetOption target={target} />}
        onChange={props.onChange}
      >
        <span class="credit-corner-value">
          <CreditTargetLogo target={props.value} />
          <span class="credit-corner-name">{props.value.name}</span>
          <CreditAmount value={format.number(props.value.balance)} class="credit-corner-balance" />
        </span>
      </SearchSelect>
    </div>
  );
}
