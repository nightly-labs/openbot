import { DEFAULT_PROVIDER_ACCOUNT_ID, type ProviderAccountStatus } from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { isApiKeyAccount, providerAccountName } from "@openbot/ui/components/provider-accounts";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";

export interface LiveVoiceAccountChoice {
  accounts: readonly ProviderAccountStatus[];
  accountId: string | null;
  defaultUsesKey: boolean;
  choose: (accountId: string | null) => Promise<void>;
}

const AUTOMATIC_ACCOUNT = "automatic";

export function LiveVoiceAccountRow(props: {
  choice: LiveVoiceAccountChoice;
  disabled: boolean;
  selectMount: HTMLElement | undefined;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const usesKey = (accountId: string) =>
    isApiKeyAccount(accountId, "codex") || (props.choice.defaultUsesKey && accountId === DEFAULT_PROVIDER_ACCOUNT_ID);
  const chosen = () => {
    const accountId = props.choice.accountId;
    return accountId && !usesKey(accountId) ? accountId : null;
  };
  const choices = () => {
    const ids = props.choice.accounts.filter((account) => !usesKey(account.id)).map((account) => account.id);
    return ids.length > 1 || chosen() ? [AUTOMATIC_ACCOUNT, ...ids] : [];
  };
  const name = (accountId: string) =>
    accountId === AUTOMATIC_ACCOUNT
      ? t("settings.voice.live.accountAutomatic")
      : providerAccountName(t, props.choice.accounts, accountId);
  const choose = (accountId: string) => {
    if (saving() || accountId === (chosen() ?? AUTOMATIC_ACCOUNT)) return;
    setError(null);
    setSaving(true);
    props.choice
      .choose(accountId === AUTOMATIC_ACCOUNT ? null : accountId)
      .catch((failure: unknown) => setError(errorMessage(failure, t("error.team.requestFailed"))))
      .finally(() => setSaving(false));
  };
  return (
    <Show when={choices().length > 0}>
      <Item class="settings-modal-row">
        <ItemContent>
          <ItemTitle id="settings-voice-live-account">{t("settings.voice.live.account")}</ItemTitle>
          <ItemDescription>{t("settings.voice.live.accountDescription")}</ItemDescription>
          <Show when={error()}>{(message) => <ItemDescription role="alert">{message()}</ItemDescription>}</Show>
        </ItemContent>
        <ItemActions>
          <Select<string>
            class="settings-modal-select"
            options={choices()}
            value={chosen() ?? AUTOMATIC_ACCOUNT}
            onChange={(next) => next && choose(next)}
            disabled={props.disabled || saving()}
            placement="bottom-end"
            itemComponent={(selectProps) => (
              <SelectItem item={selectProps.item}>{name(selectProps.item.rawValue)}</SelectItem>
            )}
          >
            <SelectTrigger size="sm" aria-labelledby="settings-voice-live-account">
              <SelectValue<string>>
                {(state) => {
                  const accountId = state.selectedOption();
                  return accountId && name(accountId);
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent mount={props.selectMount} />
          </Select>
        </ItemActions>
      </Item>
    </Show>
  );
}
