import { CRM_SOURCE_KINDS, type CrmSource, type CrmSourceKind } from "@openbot/contracts/ipc";
import {
  ArrowLeft,
  Badge,
  Button,
  ChevronRight,
  ConfirmDialog,
  Dialog,
  ExternalLink,
  Field,
  IconButton,
  Input,
  RefreshCw,
} from "@openbot/ui";
import { FileSearch } from "@openbot/ui/features/files/FileList";
import { StripeTile } from "@openbot/ui/features/settings/brand-marks";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { SOURCE_ERROR_KEY, SOURCE_KEY, timeAgo } from "./crm-model";
import type { CrmViewModel } from "./crm-state";

/** The app icon of each connector. */
const SOURCE_MARK = { stripe: StripeTile } as const satisfies Record<CrmSourceKind, () => JSX.Element>;

/** A restricted key: the host refuses a secret key and checks the permissions. */
const KEY_FORM = /^rk_(live|test)_[A-Za-z0-9]+$/u;
const KEY_MAX = 255;

/** The one dialog of the connectors. The list and the page of a connector change inside it. */
function SourceFrame(props: { crm: CrmViewModel; children: JSX.Element }) {
  return (
    <Dialog.Root open onOpenChange={(open: boolean) => !open && props.crm.closeForm()}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-confirm-dialog crm-form">
            <div class="crm-form-body">{props.children}</div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The title of a connector's page, with Back to the list. */
function SourceTitle(props: { title: string; onBack: () => void }) {
  const { t } = useText();
  return (
    <div class="crm-source-title">
      <IconButton variant="ghost" label={t("common.back")} onClick={() => props.onBack()}>
        <ArrowLeft aria-hidden="true" />
      </IconButton>
      <Dialog.Title class="crm-form-title">{props.title}</Dialog.Title>
    </div>
  );
}

/** From this many connectors, the list has a search field. */
const SEARCH_FROM = 8;

/** Each connector with its state: a dot and the last sync when it is connected. */
function ConnectorList(props: { crm: CrmViewModel; onOpen: (kind: CrmSourceKind) => void }) {
  const { t, locale } = useText();
  const [query, setQuery] = createSignal("");
  const shown = () => {
    const words = query().trim().toLocaleLowerCase(locale());
    return CRM_SOURCE_KINDS.filter((kind) => t(SOURCE_KEY[kind]).toLocaleLowerCase(locale()).includes(words));
  };
  const status = (source: CrmSource) => {
    if (source.state === "error") return t("crm.source.failed");
    if (source.state === "syncing" || source.syncedAt === null) return t("crm.source.syncing");
    return t("crm.connectors.synced", { time: timeAgo(locale(), source.syncedAt) });
  };
  return (
    <>
      <Dialog.Title class="crm-form-title">{t("crm.connectors.title")}</Dialog.Title>
      <Show when={CRM_SOURCE_KINDS.length >= SEARCH_FROM}>
        <FileSearch label={t("crm.connectors.search")} value={query()} onChange={setQuery} />
      </Show>
      <ul class="crm-connectors">
        <For each={shown()} fallback={<li class="crm-connectors-empty">{t("common.noMatches")}</li>}>
          {(kind) => {
            const Mark = SOURCE_MARK[kind];
            const source = () => props.crm.source(kind);
            return (
              <li>
                <Button type="button" variant="ghost" class="crm-connector" onClick={() => props.onOpen(kind)}>
                  <span class="crm-connector-mark">
                    <Mark />
                  </span>
                  <span class="crm-connector-name">{t(SOURCE_KEY[kind])}</span>
                  <Show when={source()}>
                    {(connected) => (
                      <span class="crm-connector-state" data-state={connected().state}>
                        <span class="crm-source-dot" aria-hidden="true" />
                        {status(connected())}
                      </span>
                    )}
                  </Show>
                  <ChevronRight class="crm-connector-go" aria-hidden="true" />
                </Button>
              </li>
            );
          }}
        </For>
      </ul>
      <div class="crm-form-actions">
        <Button variant="ghost" onClick={() => props.crm.closeForm()}>
          {t("common.close")}
        </Button>
      </div>
    </>
  );
}

function ConnectForm(props: { crm: CrmViewModel; kind: CrmSourceKind; onBack: () => void }) {
  const { t } = useText();
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const valid = () => KEY_FORM.test(key().trim());
  const name = () => t(SOURCE_KEY[props.kind]);
  const submit = async () => {
    if (!valid() || busy()) return;
    setBusy(true);
    try {
      // The dialog stays open: it shows the connected source and its first sync.
      if (await props.crm.sourceActions().connect(props.kind, key().trim())) setKey("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SourceTitle title={t("crm.source.connectTitle", { source: name() })} onBack={props.onBack} />
      <form
        class="crm-source-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Button
          type="button"
          variant="outline"
          class="crm-source-create"
          onClick={() => props.crm.sourceActions().openKeyPage(props.kind)}
        >
          <ExternalLink aria-hidden="true" />
          {t("crm.source.createKey", { source: name() })}
        </Button>
        <Field label={t("crm.source.keyLabel")} description={t("crm.source.stripeKeyHelp")}>
          <Input
            type="password"
            autocomplete="off"
            spellcheck={false}
            maxlength={KEY_MAX}
            placeholder={t("crm.source.keyPlaceholder")}
            value={key()}
            onValueChange={setKey}
          />
        </Field>
        <div class="crm-form-actions">
          <Button type="button" variant="ghost" onClick={() => props.crm.closeForm()}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!valid() || busy()}>
            {t("crm.source.connect")}
          </Button>
        </div>
      </form>
    </>
  );
}

function SourceState(props: { crm: CrmViewModel; source: CrmSource; onBack: () => void }) {
  const { t, format, locale } = useText();
  const [busy, setBusy] = createSignal(false);
  const [disconnecting, setDisconnecting] = createSignal(false);
  const name = () => t(SOURCE_KEY[props.source.kind]);
  const skipped = () =>
    [
      { count: props.source.skipped.currency, key: "crm.source.skippedCurrency" },
      { count: props.source.skipped.interval, key: "crm.source.skippedInterval" },
      { count: props.source.skipped.limit, key: "crm.source.skippedLimit" },
    ] as const;
  const anySkipped = () => skipped().some((item) => item.count > 0);
  const run = async (action: () => Promise<boolean>) => {
    if (busy()) return false;
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SourceTitle title={name()} onBack={props.onBack} />
      <dl class="crm-fields">
        <div class="crm-field">
          <dt>{t("crm.source.account")}</dt>
          <dd class="crm-static crm-source-account">
            {props.source.accountLabel || name()}
            <Show when={props.source.testMode}>
              <Badge variant="warning-light">{t("crm.source.testMode")}</Badge>
            </Show>
          </dd>
        </div>
        <div class="crm-field">
          <dt>{t("crm.source.key")}</dt>
          <dd class="crm-static">{t("crm.source.keyHint", { hint: props.source.keyHint })}</dd>
        </div>
        <div class="crm-field">
          <dt>{t("crm.source.lastSync")}</dt>
          <dd class="crm-static">
            <Show when={props.source.state !== "syncing"} fallback={t("crm.source.syncing")}>
              {props.source.syncedAt === null ? t("crm.source.never") : timeAgo(locale(), props.source.syncedAt)}
            </Show>
          </dd>
        </div>
        <Show when={props.source.state === "error" ? props.source.errorCode : null} keyed>
          {(code) => (
            <div class="crm-field">
              <dt>{t("crm.source.failed")}</dt>
              <dd class="crm-static crm-source-error" role="status">
                {t(SOURCE_ERROR_KEY[code], { source: name() })}
              </dd>
            </div>
          )}
        </Show>
        <Show when={anySkipped()}>
          <div class="crm-field">
            <dt>{t("crm.source.skipped")}</dt>
            <dd class="crm-static crm-source-skipped">
              <For each={skipped().filter((item) => item.count > 0)}>
                {(item) => <span>{t(item.key, { rows: format.number(item.count) })}</span>}
              </For>
            </dd>
          </div>
        </Show>
      </dl>
      <div class="crm-form-actions">
        <Button variant="ghost" class="crm-source-disconnect" onClick={() => setDisconnecting(true)}>
          {t("crm.source.disconnect")}
        </Button>
        <span class="crm-spacer" />
        <Button variant="ghost" onClick={() => props.crm.closeForm()}>
          {t("common.close")}
        </Button>
        <Button
          variant="outline"
          disabled={busy() || props.source.state === "syncing"}
          onClick={() => void run(() => props.crm.sourceActions().sync(props.source.id))}
        >
          <RefreshCw aria-hidden="true" />
          {t("crm.source.syncNow")}
        </Button>
      </div>
      <ConfirmDialog
        open={disconnecting()}
        tone="destructive"
        title={t("crm.source.disconnectTitle", { source: name() })}
        description={t("crm.source.disconnectBody", { source: name() })}
        confirmLabel={t("crm.source.disconnect")}
        onCancel={() => setDisconnecting(false)}
        onConfirm={async () => {
          await run(() => props.crm.sourceActions().disconnect(props.source.id));
          setDisconnecting(false);
        }}
      />
    </>
  );
}

/**
 * The connectors of the CRM: the list, and the page of one connector. A page connects its source, or
 * shows the connected one with its sync, Sync now and Disconnect.
 */
export function CrmSourceDialog(props: { crm: CrmViewModel; kind: CrmSourceKind | null }) {
  // The page changes inside the dialog, so the dialog does not close and open again.
  const [kind, setKind] = createSignal(props.kind);
  const back = () => setKind(null);
  return (
    <SourceFrame crm={props.crm}>
      <Show when={kind()} keyed fallback={<ConnectorList crm={props.crm} onOpen={setKind} />}>
        {(open) => (
          <Show when={props.crm.source(open)} fallback={<ConnectForm crm={props.crm} kind={open} onBack={back} />}>
            {(source) => <SourceState crm={props.crm} source={source()} onBack={back} />}
          </Show>
        )}
      </Show>
    </SourceFrame>
  );
}
