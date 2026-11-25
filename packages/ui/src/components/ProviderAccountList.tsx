import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountState,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  buttonVariants,
  DropdownMenu,
  Ellipsis,
  Input,
  LogIn,
  Pencil,
  Smartphone,
  Trash2,
  X,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../text";
import {
  accountCodeSignInOffered,
  isProviderKeyAccount,
  type ProviderAccountActions,
  type ProviderPickerAccount,
  providerAccountName,
} from "./provider-accounts";

const ACCOUNT_STATE_TEXT = {
  connected: "provider.status.connected",
  connecting: "provider.status.connecting",
  checking: "provider.status.checking",
  "signed-out": "provider.status.signInRequired",
  error: "provider.account.failed",
} as const satisfies Record<ProviderAccountState, AppTextKey>;

const ACCOUNT_STATE_VARIANT = {
  connected: "success-light",
  connecting: "secondary",
  checking: "secondary",
  "signed-out": "warning-light",
  error: "destructive-light",
} as const satisfies Record<ProviderAccountState, string>;

export interface ProviderAccountListProps {
  provider: AgentProviderId;
  providerName: string;
  accounts: readonly ProviderPickerAccount[];
  actions: ProviderAccountActions;
  disabled?: boolean | undefined;
  menuMount?: HTMLElement | undefined;
}

export function ProviderAccountList(props: ProviderAccountListProps) {
  const { t, format, errorMessage } = useText();
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const run = (name: string, action: () => Promise<void>) => {
    setError(null);
    void action().catch((failure: unknown) =>
      setError(errorMessage(failure, t("provider.account.actionFailed", { name }))),
    );
  };
  return (
    <div class="provider-picker-accounts">
      <ul
        class="provider-picker-account-list"
        aria-label={t("provider.account.listLabel", { name: props.providerName })}
      >
        <For each={props.accounts} keyed={(account) => account.id}>
          {(account) => {
            const name = () => providerAccountName(t, props.accounts, account().id);
            const own = () => account().id === DEFAULT_PROVIDER_ACCOUNT_ID;
            const detail = () =>
              [
                account().email && account().email !== name() ? account().email : null,
                account().usedBy?.length
                  ? t("provider.account.usedBy", { agents: format.list(account().usedBy ?? []) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");
            const state = (): ProviderAccountState =>
              Object.hasOwn(ACCOUNT_STATE_TEXT, account().state) ? account().state : "error";
            const signInOffered = () =>
              !own() &&
              !isProviderKeyAccount(props.provider, account().id) &&
              (state() === "signed-out" || state() === "error");
            const connecting = () =>
              !own() && !isProviderKeyAccount(props.provider, account().id) && state() === "connecting";
            return (
              <li class="provider-picker-account">
                <span class="provider-picker-account-copy">
                  <Show
                    when={renaming() === account().id}
                    fallback={<span class="provider-picker-name">{name()}</span>}
                  >
                    <ProviderAccountRenameField
                      value={account().label ?? ""}
                      placeholder={name()}
                      label={t("provider.account.renameLabel", { name: name() })}
                      onDone={(value) => {
                        setRenaming(null);
                        if (value === null || value === (account().label ?? "")) return;
                        run(name(), () => props.actions.rename(props.provider, account().id, value || null));
                      }}
                    />
                  </Show>
                  <Show when={detail()}>{(text) => <small class="provider-picker-email">{text()}</small>}</Show>
                  <Show when={account().state !== "connected" ? account().message : null}>
                    {(message) => <small class="provider-picker-check-error">{message()}</small>}
                  </Show>
                  <Show when={connecting() && !account().message}>
                    <small class="provider-picker-email">{t("provider.account.finishSignIn")}</small>
                  </Show>
                </span>
                <Badge class="provider-picker-status" variant={ACCOUNT_STATE_VARIANT[state()]}>
                  {t(ACCOUNT_STATE_TEXT[state()])}
                </Badge>
                <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                  <DropdownMenu.Trigger
                    class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
                    aria-label={t("provider.account.moreActions", { name: name() })}
                    disabled={props.disabled}
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item onSelect={() => setRenaming(account().id)}>
                        <Pencil aria-hidden="true" />
                        {t("common.rename")}
                      </DropdownMenu.Item>
                      <Show when={signInOffered()}>
                        <DropdownMenu.Item
                          onSelect={() => run(name(), () => props.actions.connect(props.provider, account().id))}
                        >
                          <LogIn aria-hidden="true" />
                          {t("provider.account.signInAgain")}
                        </DropdownMenu.Item>
                      </Show>
                      <Show when={signInOffered() && accountCodeSignInOffered(props.provider, props.actions)}>
                        <DropdownMenu.Item
                          onSelect={() =>
                            run(name(), async () => props.actions.connectWithCode?.(props.provider, account().id))
                          }
                        >
                          <Smartphone aria-hidden="true" />
                          {t("provider.action.signInWithCode")}
                        </DropdownMenu.Item>
                      </Show>
                      <Show when={connecting()}>
                        <DropdownMenu.Item
                          onSelect={() => run(name(), () => props.actions.cancel(props.provider, account().id))}
                        >
                          <X aria-hidden="true" />
                          {t("provider.account.cancelSignIn")}
                        </DropdownMenu.Item>
                      </Show>
                      <Show when={!own()}>
                        <DropdownMenu.Item
                          onSelect={() => run(name(), () => props.actions.remove(props.provider, account().id))}
                        >
                          <Trash2 aria-hidden="true" />
                          {t("provider.account.remove")}
                        </DropdownMenu.Item>
                      </Show>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={error()}>
        {(message) => (
          <small class="provider-picker-check-error" role="alert">
            {message()}
          </small>
        )}
      </Show>
    </div>
  );
}

export function ProviderAccountRenameField(props: {
  value: string;
  placeholder: string;
  label: string;
  maxLength?: number | undefined;
  onDone: (value: string | null) => void;
}) {
  let done = false;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    props.onDone(value === null ? null : value.trim());
  };
  const returnFocusFromClosingMenu = (input: HTMLInputElement, next: EventTarget | null) => {
    if (!(next instanceof Element) || !next.closest('[role="menuitem"]')) return false;
    requestAnimationFrame(() => {
      if (!done && input.isConnected) input.focus({ preventScroll: true });
    });
    return true;
  };
  return (
    <Input
      class="provider-picker-account-rename"
      aria-label={props.label}
      value={props.value}
      placeholder={props.placeholder}
      maxlength={props.maxLength ?? PROVIDER_ACCOUNT_LABEL_MAX_LENGTH}
      size="sm"
      ref={(element) => queueMicrotask(() => element.select())}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") {
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(event) => {
        if (returnFocusFromClosingMenu(event.currentTarget, event.relatedTarget)) return;
        finish(event.currentTarget.value);
      }}
    />
  );
}
