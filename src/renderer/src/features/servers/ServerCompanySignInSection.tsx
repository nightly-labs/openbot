import type { CompanySignInSettings, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  CircleCheck,
  ConfirmDialog,
  CopyButton,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  KeyRound,
  LogIn,
  SettingsSection,
  Text,
  toast,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show } from "solid-js";
import type { ServerSettingsSectionHost } from "./server-settings-section";

/** What the section calls in main. Only the desktop app manages company sign-in. */
export type CompanySignInCalls = Pick<
  OpenBotDesktopApi["auth"],
  | "getCompanySignIn"
  | "testCompanySignIn"
  | "cancelCompanySignInTest"
  | "setCompanySignInEnabled"
  | "removeCompanySignIn"
  | "createCompanySignInScimToken"
  | "revokeCompanySignInScimToken"
>;

/** Examples in the empty fields: an Entra ID issuer and a domain. They are not prose. */
const ISSUER_PLACEHOLDER = "https://login.microsoftonline.com/<tenant>/v2.0";
const DOMAIN_PLACEHOLDER = "example.com";

interface CompanySignInForm {
  issuer: string;
  clientId: string;
  clientSecret: string;
  domains: string;
  test:
    | { status: "idle" }
    | { status: "testing" }
    | { status: "passed"; email: string }
    | { status: "failed"; message: string };
}

interface CompanySignInPanel {
  settings: CompanySignInSettings | null;
  loadError: string | null;
  dialogOpen: boolean;
  confirm: "remove" | "revoke" | null;
  /** A new SCIM token. The account service keeps only its hash, so it shows once. */
  newToken: string | null;
}

function domainList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/u)
        .map((domain) => domain.trim().replace(/^@/u, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function issuerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}

/**
 * Company sign-in in Members: one card with single sign-on and user sync, and a dialog for the
 * provider values. Only the owner of a published server sees it. Where the app cannot manage it
 * (the browser client), the card shows only the single sign-on row with no status, and Set up tells
 * the owner to use the desktop app.
 */
export function createServerCompanySignInSection(
  host: ServerSettingsSectionHost,
  calls: () => CompanySignInCalls | undefined,
  download: () => (() => void) | undefined,
  visible: () => boolean,
) {
  const { t, errorMessage } = useText();
  const { props, published, configured, actionsAvailable, busy, run } = host;
  const [panel, setPanel] = createStore<CompanySignInPanel>({
    settings: null,
    loadError: null,
    dialogOpen: false,
    confirm: null,
    newToken: null,
  });
  const [form, setForm] = createStore<CompanySignInForm>({
    issuer: "",
    clientId: "",
    clientSecret: "",
    domains: "",
    test: { status: "idle" },
  });
  const eligible = () => props.server.role === "owner" && configured() && published() && actionsAvailable();
  const available = () => Boolean(calls()) && eligible();
  const desktopOnly = () => (!calls() && eligible() ? download() : undefined);
  const connection = () => panel.settings?.connection ?? null;
  const enabled = () => connection()?.enabled === true;
  const serverId = () => props.server.id;

  async function load(id: string): Promise<void> {
    const api = calls();
    if (!api) return;
    try {
      const settings = await api.getCompanySignIn(id);
      if (serverId() !== id) return;
      setPanel((state) => {
        state.settings = settings;
        state.loadError = null;
      });
    } catch (error) {
      if (serverId() !== id) return;
      setPanel((state) => {
        state.loadError = errorMessage(error, t("server.companySignIn.loadFailed"));
      });
    }
  }

  createEffect(
    () => (visible() && available() ? serverId() : null),
    (id) => {
      if (id) void load(id);
    },
  );

  function resetForServer(): void {
    setPanel((state) => {
      state.settings = null;
      state.loadError = null;
      state.dialogOpen = false;
      state.confirm = null;
      state.newToken = null;
    });
  }

  function openDialog(): void {
    const current = connection();
    setForm((draft) => {
      draft.issuer = current?.issuer ?? "";
      draft.clientId = current?.clientId ?? "";
      draft.clientSecret = "";
      draft.domains = current?.domains.join(", ") ?? "";
      draft.test = { status: "idle" };
    });
    setPanel((state) => {
      state.dialogOpen = true;
    });
  }

  function closeDialog(): void {
    if (form.test.status === "testing") void calls()?.cancelCompanySignInTest();
    setPanel((state) => {
      state.dialogOpen = false;
    });
  }

  function setTest(test: CompanySignInForm["test"]): void {
    setForm((draft) => {
      draft.test = test;
    });
  }

  function edit(patch: Partial<Omit<CompanySignInForm, "test">>): void {
    setForm((draft) => {
      Object.assign(draft, patch);
      draft.test = { status: "idle" };
    });
  }

  const formComplete = () =>
    Boolean(form.issuer.trim() && form.clientId.trim() && form.clientSecret && domainList(form.domains).length > 0);

  async function test(): Promise<void> {
    const api = calls();
    if (!api || !formComplete() || form.test.status === "testing") return;
    const id = serverId();
    setTest({ status: "testing" });
    try {
      const result = await api.testCompanySignIn({
        serverId: id,
        issuer: form.issuer.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret,
        domains: domainList(form.domains),
      });
      setTest({ status: "passed", email: result.email });
      await load(id);
    } catch (error) {
      setTest({ status: "failed", message: errorMessage(error, t("server.companySignIn.testFailed")) });
    }
  }

  async function setEnabled(value: boolean): Promise<void> {
    const api = calls();
    if (!api) return;
    const id = serverId();
    await run("company-sign-in", async () => {
      const settings = await api.setCompanySignInEnabled({ serverId: id, enabled: value });
      setPanel((state) => {
        state.settings = settings;
        state.dialogOpen = false;
      });
    });
  }

  async function remove(): Promise<void> {
    const api = calls();
    if (!api) return;
    const id = serverId();
    await run("company-sign-in", async () => {
      const settings = await api.removeCompanySignIn(id);
      setPanel((state) => {
        state.settings = settings;
        state.confirm = null;
        state.dialogOpen = false;
        state.newToken = null;
      });
    });
  }

  async function createToken(): Promise<void> {
    const api = calls();
    if (!api) return;
    const id = serverId();
    await run("company-sign-in-scim", async () => {
      const token = await api.createCompanySignInScimToken(id);
      setPanel((state) => {
        state.newToken = token.token;
        const current = state.settings?.connection;
        if (current) current.scimTokenCreatedAt = token.createdAt;
      });
    });
  }

  async function revokeToken(): Promise<void> {
    const api = calls();
    if (!api) return;
    const id = serverId();
    await run("company-sign-in-scim", async () => {
      const settings = await api.revokeCompanySignInScimToken(id);
      setPanel((state) => {
        state.settings = settings;
        state.newToken = null;
        state.confirm = null;
      });
    });
  }

  function status(): string {
    const current = connection();
    if (!current) return t("server.companySignIn.off");
    const domains = current.domains.map((domain) => `@${domain}`).join(", ");
    return enabled()
      ? t("server.companySignIn.onStatus", { provider: issuerHost(current.issuer), domains })
      : t("server.companySignIn.testedStatus", { domains });
  }

  function DesktopOnlyPanel() {
    return (
      <Show when={desktopOnly()}>
        {(openDownload) => (
          <SettingsSection title={t("server.companySignIn.title")}>
            <ItemGroup class="settings-modal-card">
              <Item>
                <ItemContent>
                  <ItemTitle>{t("server.companySignIn.sso")}</ItemTitle>
                  <ItemDescription>{t("server.companySignIn.dialogSubtitle")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      toast.info(t("server.companySignIn.desktopOnly"), {
                        id: "company-sign-in-desktop-only",
                        action: { label: t("common.download"), onClick: () => openDownload()() },
                      })
                    }
                  >
                    {t("server.companySignIn.setUp")}
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        )}
      </Show>
    );
  }

  function Panel() {
    return (
      <Show when={available() && (panel.settings || panel.loadError)} fallback={<DesktopOnlyPanel />}>
        <SettingsSection title={t("server.companySignIn.title")}>
          <ItemGroup class="settings-modal-card">
            <Show
              when={panel.settings}
              fallback={
                <Item>
                  <ItemContent>
                    <ItemDescription>{panel.loadError}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button type="button" size="sm" variant="outline" onClick={() => void load(serverId())}>
                      {t("common.tryAgain")}
                    </Button>
                  </ItemActions>
                </Item>
              }
            >
              <Item>
                <ItemContent>
                  <ItemTitle>
                    {t("server.companySignIn.sso")}
                    <Badge variant={enabled() ? "success-light" : "secondary"}>
                      {enabled() ? t("server.companySignIn.badgeOn") : t("server.companySignIn.badgeOff")}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>{status()}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant={connection() ? "outline" : "default"}
                    disabled={Boolean(busy())}
                    onClick={openDialog}
                  >
                    {connection() ? t("server.companySignIn.edit") : t("server.companySignIn.setUp")}
                  </Button>
                </ItemActions>
              </Item>
              <Show when={connection()}>
                {(current) => (
                  <Item>
                    <ItemContent>
                      <ItemTitle>{t("server.companySignIn.scim")}</ItemTitle>
                      <ItemDescription>
                        {current().scimTokenCreatedAt ? panel.settings?.scimUrl : t("server.companySignIn.scimOff")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Show
                        when={current().scimTokenCreatedAt}
                        fallback={
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(busy())}
                            loading={busy() === "company-sign-in-scim"}
                            onClick={() => void createToken()}
                          >
                            <KeyRound aria-hidden="true" />
                            {t("server.companySignIn.createToken")}
                          </Button>
                        }
                      >
                        <CopyButton
                          value={panel.settings?.scimUrl}
                          label={t("server.companySignIn.copyScimUrl")}
                          size="sm"
                          variant="ghost"
                          onCopyError={host.showCopyError}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(busy())}
                          onClick={() =>
                            setPanel((state) => {
                              state.confirm = "revoke";
                            })
                          }
                        >
                          {t("server.companySignIn.revokeToken")}
                        </Button>
                      </Show>
                    </ItemActions>
                  </Item>
                )}
              </Show>
              <Show when={panel.newToken}>
                {(token) => (
                  <Item>
                    <ItemContent>
                      <ItemTitle>{t("server.companySignIn.newTokenTitle")}</ItemTitle>
                      <ItemDescription>{t("server.companySignIn.newTokenDescription")}</ItemDescription>
                      <div class="company-sign-in-copy-row">
                        <Input
                          size="sm"
                          value={token()}
                          readonly
                          aria-label={t("server.companySignIn.newTokenTitle")}
                        />
                        <CopyButton value={token()} size="sm" variant="outline" onCopyError={host.showCopyError} />
                      </div>
                    </ItemContent>
                  </Item>
                )}
              </Show>
            </Show>
          </ItemGroup>
        </SettingsSection>
        <SetupDialog />
        <ConfirmDialog
          open={panel.confirm !== null}
          initialFocus="cancel"
          pending={busy() === "company-sign-in" || busy() === "company-sign-in-scim"}
          title={
            panel.confirm === "remove" ? t("server.companySignIn.removeTitle") : t("server.companySignIn.revokeTitle")
          }
          description={
            panel.confirm === "remove"
              ? t("server.companySignIn.removeDescription")
              : t("server.companySignIn.revokeDescription")
          }
          confirmLabel={panel.confirm === "remove" ? t("common.remove") : t("server.companySignIn.revokeToken")}
          onCancel={() =>
            setPanel((state) => {
              state.confirm = null;
            })
          }
          onConfirm={() => (panel.confirm === "remove" ? remove() : revokeToken())}
        />
      </Show>
    );
  }

  function SetupDialog() {
    const title = () => (connection() ? t("server.companySignIn.editTitle") : t("server.companySignIn.setUpTitle"));
    const domains = () => domainList(form.domains);
    const passed = () => (form.test.status === "passed" ? form.test : undefined);
    const failed = () => (form.test.status === "failed" ? form.test.message : undefined);
    return (
      <Dialog.Root open={panel.dialogOpen} onOpenChange={(next) => !next && closeDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay class="custom-provider-backdrop">
            <Dialog.Content
              as="section"
              class="custom-provider-dialog company-sign-in-dialog"
              aria-busy={form.test.status === "testing" ? "true" : undefined}
            >
              <Dialog.Title class="sr-only">{title()}</Dialog.Title>
              <header class="custom-provider-header">
                <span class="custom-provider-mark" aria-hidden="true">
                  <KeyRound />
                </span>
                <div class="custom-provider-title">
                  <Heading as="h2" size="md">
                    {title()}
                  </Heading>
                  <Text tone="secondary" variant="caption">
                    {t("server.companySignIn.dialogSubtitle")}
                  </Text>
                </div>
                <IconButton
                  class="custom-provider-close"
                  label={t("common.close")}
                  variant="ghost"
                  onClick={closeDialog}
                >
                  <X />
                </IconButton>
              </header>
              <form
                class="custom-provider-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (passed() && !enabled()) void setEnabled(true);
                  else if (passed()) closeDialog();
                  else void test();
                }}
              >
                <div class="custom-provider-form">
                  <Field label={t("server.companySignIn.redirectUrl")}>
                    <div class="company-sign-in-copy-row">
                      <Input value={panel.settings?.redirectUri ?? ""} readonly />
                      <CopyButton
                        value={panel.settings?.redirectUri}
                        size="sm"
                        variant="outline"
                        onCopyError={host.showCopyError}
                      />
                    </div>
                  </Field>
                  <Field label={t("server.companySignIn.issuer")}>
                    <Input
                      type="url"
                      inputmode="url"
                      autocomplete="off"
                      spellcheck={false}
                      placeholder={ISSUER_PLACEHOLDER}
                      value={form.issuer}
                      onValueChange={(issuer) => edit({ issuer })}
                    />
                  </Field>
                  <Field label={t("server.companySignIn.clientId")}>
                    <Input
                      autocomplete="off"
                      spellcheck={false}
                      value={form.clientId}
                      onValueChange={(clientId) => edit({ clientId })}
                    />
                  </Field>
                  <Field label={t("server.companySignIn.clientSecret")}>
                    <Input
                      type="password"
                      autocomplete="off"
                      spellcheck={false}
                      placeholder={connection() ? t("server.companySignIn.clientSecretAgain") : undefined}
                      value={form.clientSecret}
                      onValueChange={(clientSecret) => edit({ clientSecret })}
                    />
                  </Field>
                  <Field label={t("server.companySignIn.domains")}>
                    <Input
                      autocomplete="off"
                      spellcheck={false}
                      placeholder={DOMAIN_PLACEHOLDER}
                      value={form.domains}
                      onValueChange={(value) => edit({ domains: value })}
                    />
                  </Field>
                  <Show when={panel.settings?.domainCheck && domains().length > 0 ? panel.settings : undefined}>
                    {(settings) => (
                      <Field label={t("server.companySignIn.dnsRecord")}>
                        <Text variant="caption" tone="secondary">
                          {t("server.companySignIn.dnsRecordDescription", {
                            name: `${settings().domainRecord.name}.${domains()[0]}`,
                          })}
                        </Text>
                        <div class="company-sign-in-copy-row">
                          <Input value={settings().domainRecord.value} readonly />
                          <CopyButton
                            value={settings().domainRecord.value}
                            size="sm"
                            variant="outline"
                            onCopyError={host.showCopyError}
                          />
                        </div>
                      </Field>
                    )}
                  </Show>
                  <Show when={passed()}>
                    {(result) => (
                      <Text variant="label-sm" tone="secondary" class="company-sign-in-passed" role="status">
                        <CircleCheck aria-hidden="true" />
                        {t("server.companySignIn.testPassed", { email: result().email })}
                      </Text>
                    )}
                  </Show>
                  <Show when={failed()}>
                    {(message) => (
                      <Text variant="label-sm" tone="danger" role="alert">
                        {message()}
                      </Text>
                    )}
                  </Show>
                </div>
                <footer class="custom-provider-actions">
                  <Show
                    when={passed()}
                    fallback={
                      <Button
                        type="submit"
                        variant="default"
                        disabled={!formComplete()}
                        loading={form.test.status === "testing"}
                        loadingLabel={t("server.companySignIn.testing")}
                      >
                        <LogIn aria-hidden="true" />
                        {t("server.companySignIn.test")}
                      </Button>
                    }
                  >
                    <Button type="submit" variant="default" loading={busy() === "company-sign-in"}>
                      {enabled() ? t("common.done") : t("server.companySignIn.turnOn")}
                    </Button>
                  </Show>
                  <Show when={connection()}>
                    <div class="company-sign-in-secondary">
                      <Show
                        when={enabled()}
                        fallback={
                          <Show when={!passed()}>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={Boolean(busy())}
                              onClick={() => void setEnabled(true)}
                            >
                              {t("server.companySignIn.turnOn")}
                            </Button>
                          </Show>
                        }
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(busy())}
                          onClick={() => void setEnabled(false)}
                        >
                          {t("server.companySignIn.turnOff")}
                        </Button>
                      </Show>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(busy())}
                        onClick={() =>
                          setPanel((state) => {
                            state.confirm = "remove";
                          })
                        }
                      >
                        {t("common.remove")}
                      </Button>
                    </div>
                  </Show>
                </footer>
              </form>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return { Panel, resetForServer };
}
