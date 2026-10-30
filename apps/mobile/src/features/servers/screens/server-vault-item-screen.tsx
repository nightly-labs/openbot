import {
  VAULT_API_KEY_LIMIT,
  VAULT_NOTES_LIMIT,
  VAULT_PASSWORD_LIMIT,
  VAULT_TEXT_LIMIT,
  type VaultContactSummary,
  type VaultItemKind,
  type VaultItemSummary,
  type VaultState,
} from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { Children, type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { useServerVault } from "@/features/servers/model/use-server-vault";
import {
  type VaultDraft,
  vaultCardTitle,
  vaultContactTitle,
  vaultCountryOptions,
  vaultDraft,
  vaultLoginTitle,
  vaultSaveInput,
} from "@/features/servers/model/vault-items";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import type { SheetFormFieldProps } from "@/shared/components/sheet-form-field.types";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const KINDS: readonly VaultItemKind[] = ["login", "card", "contact", "apiKey"];
// An address, the same in each language.
const WEBSITE_PLACEHOLDER = "https://example.com";
const VARIABLE_NAME_LIMIT = 64;

/** Short fields side by side, each with an equal share of the width. */
function FieldRow({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-3">
      {Children.map(children, (child) => (
        <View className="min-w-0 flex-1">{child}</View>
      ))}
    </View>
  );
}

type FieldProps = Partial<Omit<SheetFormFieldProps, "label" | "value" | "onChangeText">>;
type TextKey = Exclude<keyof VaultDraft, "fillSites">;

function isKind(value: string | undefined): value is VaultItemKind {
  return KINDS.some((kind) => kind === value);
}

/**
 * Server settings › Vault › one item of a joined server, or a new one of `kind`. The header action
 * saves it. A saved secret is never shown: its field starts empty, and a value typed there replaces it.
 */
export function ServerVaultItemScreen() {
  const { t } = useText();
  const { serverId, itemId, kind } = useLocalSearchParams<{ serverId: string; itemId?: string; kind?: string }>();
  const vault = useServerVault(serverId);
  const saved = itemId ? vault.query.data?.items.find((item) => item.id === itemId) : undefined;
  const itemKind = saved?.kind ?? (isKind(kind) && (kind !== "apiKey" || vault.canManageApiKeys) ? kind : undefined);
  if (!vault.server || !vault.canManage || !itemKind || (itemId && !saved))
    return (
      <SettingsContent>
        <SettingsNote>
          {!vault.server
            ? t("mobile.server.unavailable")
            : !vault.canManage
              ? t("mobile.server.vault.unavailable")
              : vault.query.isPending && !vault.query.isError
                ? t("mobile.server.vault.loading")
                : t("mobile.server.vault.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  const contacts = (vault.query.data?.items ?? []).filter(
    (item): item is VaultContactSummary => item.kind === "contact",
  );
  return (
    <VaultItemForm
      key={saved?.id ?? itemKind}
      serverId={serverId}
      host={vault.server.name}
      kind={itemKind}
      saved={saved}
      contacts={contacts}
      vault={vault}
    />
  );
}

function VaultItemForm({
  serverId,
  host,
  kind,
  saved,
  contacts,
  vault,
}: {
  serverId: string;
  host: string;
  kind: VaultItemKind;
  saved: VaultItemSummary | undefined;
  contacts: VaultContactSummary[];
  vault: ReturnType<typeof useServerVault>;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const { saveVaultItem, deleteVaultItem } = useMobileWorkspaceActions();
  const { action, perform, setState } = vault;
  const [initial] = useState(() => vaultDraft(saved));
  const [draft, setDraft] = useState<VaultDraft>(initial);
  // Navigation runs a render later, once the guard below reads `leaving`.
  const [leaving, setLeaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // The state without a deleted item. It is shown after this page goes, so the page does not say "gone".
  const removedState = useRef<VaultState | null>(null);
  const showState = useRef(setState);
  showState.current = setState;
  useEffect(() => {
    if (!leaving) return;
    router.back();
    const state = removedState.current;
    removedState.current = null;
    if (state) void showState.current(state);
  }, [leaving]);
  const input = vaultSaveInput(kind, saved?.id ?? null, draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const locked = action.isPending;

  usePreventRemove(!discarding && (dirty || locked) && !leaving, ({ repeat }) => {
    if (locked) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

  const edit = (change: Partial<VaultDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    if (action.error) action.reset();
  };
  const save = () => {
    if (!input) return;
    void perform(async () => {
      await setState(await saveVaultItem(input, serverId));
    }).then((done) => {
      if (done) setLeaving(true);
    });
  };
  const remove = () => {
    if (!saved) return;
    Alert.alert(t("mobile.server.vault.deleteTitle"), t("mobile.server.vault.deleteBody", { host }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.server.vault.deleteConfirm"),
        style: "destructive",
        onPress: () =>
          void perform(async () => {
            removedState.current = await deleteVaultItem(saved.id, serverId);
          }).then((done) => {
            if (done) setLeaving(true);
          }),
      },
    ]);
  };

  const editText = (key: TextKey, value: string) => {
    setDraft((current) => {
      const next = { ...current };
      next[key] = value;
      return next;
    });
    if (action.error) action.reset();
  };
  /** One text field of the draft. */
  const field = (key: TextKey, label: string, props: FieldProps = {}) => (
    <SheetFormField
      label={label}
      autoCorrect={false}
      maxLength={VAULT_TEXT_LIMIT}
      editable={!locked}
      value={draft[key]}
      // A variable name is capitals: the keyboard capitalizes typed letters, not pasted text.
      onChangeText={(value) => editText(key, key === "name" ? value.toUpperCase() : value)}
      {...props}
    />
  );
  /** A secret field: empty for a saved item, which keeps its secret until a new one is typed. */
  const secret = (key: "password" | "number" | "securityCode" | "key", label: string, props: FieldProps) =>
    field(key, label, {
      autoCapitalize: "none",
      isRequired: !saved && key !== "securityCode",
      placeholder: saved ? t("mobile.server.vault.secretSaved") : undefined,
      ...props,
    });

  const title = saved
    ? saved.kind === "login"
      ? vaultLoginTitle(saved)
      : saved.kind === "card"
        ? vaultCardTitle(saved, t)
        : saved.kind === "apiKey"
          ? saved.name
          : vaultContactTitle(saved, t)
    : t(
        kind === "login"
          ? "mobile.server.vault.newLogin"
          : kind === "card"
            ? "mobile.server.vault.newCard"
            : kind === "apiKey"
              ? "mobile.server.vault.newApiKey"
              : "mobile.server.vault.newContact",
      );
  const failure = action.error
    ? errorMessage(action.error, t(saved ? "mobile.server.vault.saveFailed" : "mobile.server.vault.addFailed"))
    : null;

  return (
    <SettingsContent>
      <Stack.Screen options={{ title }} />
      <SheetSaveAction
        dirty={dirty}
        canSave={input !== null && !locked}
        pending={locked && dirty}
        label={saved ? undefined : t("mobile.server.vault.addConfirm")}
        onSave={save}
      />
      {failure ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {failure}
        </Typography.Paragraph>
      ) : null}
      <View className="gap-5">
        {kind === "login" ? (
          <>
            {field("website", t("mobile.server.vault.website"), {
              isRequired: true,
              autoCapitalize: "none",
              inputMode: "url",
              placeholder: WEBSITE_PLACEHOLDER,
              hint: t("mobile.server.vault.websiteHint"),
            })}
            {field("username", t("mobile.server.vault.username"), { autoCapitalize: "none" })}
            {secret("password", t("mobile.server.vault.password"), {
              secureTextEntry: true,
              maxLength: VAULT_PASSWORD_LIMIT,
              hint: t("mobile.server.vault.secretHint", { host }),
            })}
            {field("notes", t("mobile.server.vault.notes"), { multiline: true, maxLength: VAULT_NOTES_LIMIT })}
          </>
        ) : kind === "card" ? (
          <>
            {field("label", t("mobile.server.vault.label"))}
            {field("nameOnCard", t("mobile.server.vault.nameOnCard"))}
            {secret("number", t("mobile.server.vault.cardNumber"), {
              inputMode: "numeric",
              maxLength: 23,
            })}
            <View className="gap-1">
              <FieldRow>
                {field("expMonth", t("mobile.server.vault.expMonth"), {
                  isRequired: true,
                  inputMode: "numeric",
                  maxLength: 2,
                  placeholder: t("mobile.server.vault.expMonthPlaceholder"),
                })}
                {field("expYear", t("mobile.server.vault.expYear"), {
                  isRequired: true,
                  inputMode: "numeric",
                  maxLength: 4,
                  placeholder: t("mobile.server.vault.expYearPlaceholder"),
                })}
                {secret("securityCode", t("mobile.server.vault.securityCode"), {
                  inputMode: "numeric",
                  secureTextEntry: true,
                  maxLength: 4,
                  placeholder: saved ? t("mobile.server.vault.secretSavedShort") : undefined,
                })}
              </FieldRow>
              <View className="px-1">
                <Typography.Paragraph type="body-xs" className="text-text-secondary">
                  {t("mobile.server.vault.secretHint", { host })}
                </Typography.Paragraph>
              </View>
            </View>
          </>
        ) : kind === "apiKey" ? (
          <>
            {field("name", t("mobile.server.vault.variableName"), {
              isRequired: true,
              autoCapitalize: "characters",
              maxLength: VARIABLE_NAME_LIMIT,
              placeholder: t("mobile.server.vault.variableNamePlaceholder"),
              hint: t("mobile.server.vault.variableNameHint"),
            })}
            {secret("key", t("mobile.server.vault.apiKey"), {
              secureTextEntry: true,
              maxLength: VAULT_API_KEY_LIMIT,
              hint: t("mobile.server.vault.secretHint", { host }),
            })}
            {field("notes", t("mobile.server.vault.notes"), { multiline: true, maxLength: VAULT_NOTES_LIMIT })}
          </>
        ) : (
          <>
            {field("label", t("mobile.server.vault.label"))}
            {field("fullName", t("mobile.server.vault.fullName"))}
            {field("address", t("mobile.server.vault.address"))}
            {field("address2", t("mobile.server.vault.address2"))}
            <FieldRow>
              {field("postalCode", t("mobile.server.vault.postalCode"))}
              {field("city", t("mobile.server.vault.city"))}
            </FieldRow>
            {field("region", t("mobile.server.vault.region"))}
            <SettingsSection>
              <SettingsRow
                disclosure={false}
                trailing={
                  <SettingsPicker
                    value={draft.country}
                    enabled={!locked}
                    dark={theme === "dark"}
                    label={t("mobile.server.vault.country")}
                    options={vaultCountryOptions(t, draft.country)}
                    onChange={(value) => edit({ country: value })}
                  />
                }
              >
                <Typography.Paragraph>{t("mobile.server.vault.country")}</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
            {field("phone", t("mobile.server.vault.phone"), { inputMode: "tel" })}
            {field("email", t("mobile.server.vault.email"), { autoCapitalize: "none", inputMode: "email" })}
          </>
        )}
      </View>
      {kind === "card" ? (
        <SettingsSection title={t("mobile.server.vault.billingContact")}>
          <SettingsRow
            disclosure={false}
            trailing={
              <SettingsPicker
                value={draft.billingContactId}
                enabled={!locked}
                dark={theme === "dark"}
                label={t("mobile.server.vault.billingContact")}
                options={[
                  { value: "", label: t("mobile.server.vault.billingNone") },
                  ...contacts.map((contact) => ({ value: contact.id, label: vaultContactTitle(contact, t) })),
                ]}
                onChange={(value) => edit({ billingContactId: value })}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.server.vault.billingContact")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {kind === "card" && draft.fillSites.length > 0 ? (
        <SettingsSection title={t("mobile.server.vault.fillSites")} footer={t("mobile.server.vault.fillSitesFooter")}>
          {draft.fillSites.map((site) => (
            <SettingsRow
              key={site}
              disclosure={false}
              disabled={locked}
              accessibilityLabel={t("mobile.server.vault.removeSite", { site })}
              trailing={
                <Typography.Paragraph className="text-danger-text">
                  {t("mobile.server.vault.remove")}
                </Typography.Paragraph>
              }
              onPress={() => edit({ fillSites: draft.fillSites.filter((entry) => entry !== site) })}
            >
              <Typography.Paragraph numberOfLines={1}>{site}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {saved ? (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={locked} onPress={remove}>
            <Typography.Paragraph className="text-danger-text">{t("mobile.server.vault.delete")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
