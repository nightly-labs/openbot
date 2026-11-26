import type {
  CreditExpiring,
  CreditServerRole,
  CreditServerWallet,
  CreditTransferDirection,
} from "@openbot/contracts/credits";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowDown,
  ArrowUp,
  Button,
  buttonVariants,
  DropdownMenu,
  Ellipsis,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  ServerPlushLogo,
  SettingsSection,
  Text,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { CreditIcon } from "./CreditIcon";
import { type CreditsStore, movablePersonalCredits } from "./credits-store";
import { MoveCreditsDialog } from "./MoveCreditsDialog";

const ROLE_LABEL = {
  owner: "billing.credits.role.owner",
  admin: "billing.credits.role.admin",
  member: "billing.credits.role.member",
} as const satisfies Record<CreditServerRole, AppTextKey>;

export interface CreditsSectionProps {
  store: CreditsStore;
  onBuy: (serverId: string | null) => void;
}

interface MoveRequest {
  server: CreditServerWallet;
  direction: CreditTransferDirection;
}

function ExpiringCredits(props: { expiring: CreditExpiring | undefined }) {
  const { t, format } = useText();
  return (
    <Show when={props.expiring}>
      {(expiring) => (
        <ItemDescription>
          {t("billing.credits.expiring", {
            count: expiring().credits,
            amount: format.number(expiring().credits),
            date: format.date(new Date(expiring().expiresAt), { dateStyle: "long" }),
          })}
        </ItemDescription>
      )}
    </Show>
  );
}

function ServerCreditsMenu(props: {
  server: CreditServerWallet;
  personal: number;
  disabled: boolean;
  onMove: (direction: CreditTransferDirection) => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("billing.credits.menu", { server: props.server.name })}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item disabled={props.personal <= 0} onSelect={() => props.onMove("to_server")}>
            <ArrowDown aria-hidden="true" />
            {t("billing.credits.moveIn")}
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={props.server.balance <= 0} onSelect={() => props.onMove("to_personal")}>
            <ArrowUp aria-hidden="true" />
            {t("billing.credits.moveOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ServerCreditsRow(props: {
  server: CreditServerWallet;
  store: CreditsStore;
  onBuy: (serverId: string) => void;
  onMove: (request: MoveRequest) => void;
}) {
  const { t, format } = useText();
  return (
    <Item class="billing-server credits-section-row" role="listitem">
      <ItemMedia>
        <ServerPlushLogo class="billing-server-logo" seed={props.server.serverId} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.server.name}</ItemTitle>
        <ItemDescription>
          {t("billing.credits.serverLine", {
            credits: t("billing.credits.amount", {
              count: props.server.balance,
              amount: format.number(props.server.balance),
            }),
            role: t(ROLE_LABEL[props.server.role]),
          })}
        </ItemDescription>
        <ExpiringCredits expiring={props.server.expiring} />
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("billing.credits.buyFor", { name: props.server.name })}
          onClick={() => props.onBuy(props.server.serverId)}
        >
          {t("billing.credits.buy")}
        </Button>
        <Show when={props.server.role === "owner"}>
          <ServerCreditsMenu
            server={props.server}
            personal={movablePersonalCredits(props.store.state.credits)}
            disabled={props.store.state.pending !== null}
            onMove={(direction) => props.onMove({ server: props.server, direction })}
          />
        </Show>
      </ItemActions>
    </Item>
  );
}

export function CreditsSection(props: CreditsSectionProps): JSX.Element {
  const { t, format } = useText();
  const [moving, setMoving] = createSignal<MoveRequest | null>(null);
  const credits = () => {
    const state = props.store.state.credits;
    return state?.available ? state : null;
  };
  const movingServer = () => {
    const request = moving();
    const state = credits();
    if (!request || !state) return null;
    const server = state.servers.find((item) => item.serverId === request.server.serverId);
    return server ? { server, direction: request.direction } : null;
  };

  return (
    <Show when={credits()}>
      {(state) => (
        <SettingsSection title={t("billing.credits.title")}>
          <ItemGroup class="settings-modal-card">
            <Item class="credits-section-row">
              <ItemMedia>
                <CreditIcon class="credits-section-icon" tile />
              </ItemMedia>
              <ItemContent>
                <ItemTitle class="credits-section-balance">
                  {t("billing.credits.amount", {
                    count: state().balance,
                    amount: format.number(state().balance),
                  })}
                </ItemTitle>
                <ItemDescription>{t("billing.credits.yours")}</ItemDescription>
                <Show when={state().welcome}>
                  {(welcome) => (
                    <ItemDescription>
                      {t("billing.credits.welcomeIncluded", { amount: format.number(welcome()) })}
                    </ItemDescription>
                  )}
                </Show>
                <ExpiringCredits expiring={state().expiring} />
              </ItemContent>
              <ItemActions>
                <Button size="sm" onClick={() => props.onBuy(null)}>
                  {t("billing.credits.buy")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Show when={state().servers.length > 0}>
            <Text variant="caption" tone="muted">
              {t("billing.credits.serversTitle")}
            </Text>
            <ItemGroup class="settings-modal-card" role="list">
              <For each={state().servers} keyed={(server) => server.serverId}>
                {(server) => (
                  <ServerCreditsRow
                    server={server()}
                    store={props.store}
                    onBuy={(serverId) => props.onBuy(serverId)}
                    onMove={setMoving}
                  />
                )}
              </For>
            </ItemGroup>
          </Show>
          <Show when={movingServer()}>
            {(request) => (
              <MoveCreditsDialog
                store={props.store}
                server={request().server}
                direction={request().direction}
                onClose={() => setMoving(null)}
              />
            )}
          </Show>
        </SettingsSection>
      )}
    </Show>
  );
}
