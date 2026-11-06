import {
  BROWSER_PROXY_ADDRESS_MAX,
  type BrowserProxyComputer,
  type BrowserProxyFailure,
  type BrowserProxyNameParts,
  type BrowserProxySummary,
  browserProxyName,
  browserProxySaveAddress,
  editableBrowserProxyAddress,
  parseBrowserProxyAddress,
} from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  buttonVariants,
  Check,
  ChevronRight,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Monitor,
  Pencil,
  Plus,
  SettingsSection,
  Text,
  Trash2,
  Waypoints,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, For, Show, untrack } from "solid-js";
import { useText } from "../../text";

/**
 * A new proxy, or a change to one. A change also has the address that the person changed, so that
 * the host can refuse it when a different admin changed the proxy first. `assignTo` is the named
 * profile that uses a new proxy at once.
 */
export interface BrowserProxyDraft {
  proxyId?: string;
  previousAddress?: string;
  /** The address has no password, and the saved password stays. */
  keepPassword?: boolean;
  address: string;
  assignTo?: string;
}

/** The proxy choice of the named profiles, for a server with proxy routes. */
export interface BrowserProfileProxies {
  list: readonly BrowserProxySummary[];
  /** The computers of members. Each one sends pages through the OpenBot app of its member. */
  computers: readonly BrowserProxyComputer[];
  /**
   * Whether this app shares its connection with the server. Undefined: this app cannot share it,
   * as on the web client or for the computer that runs the agents.
   */
  sharing?: boolean | undefined;
  onSave: (draft: BrowserProxyDraft) => Promise<void>;
  /**
   * Its profiles change to the proxy settings of the computer. `profileIds`: the profiles that the
   * person saw use it; the host refuses the delete when they changed. Takes a computer id too.
   */
  onDelete: (proxyId: string, profileIds: readonly string[]) => Promise<void>;
  /** Null: the proxy settings of the computer ("Automatic"). Takes a computer id too. */
  onSetProfileProxy: (profileId: string, proxyId: string | null) => Promise<void>;
  /** On also adds the computer of this member. `assignTo`: the named profile that uses it at once. */
  onSetSharing?: (sharing: boolean, assignTo?: string) => Promise<void>;
}

/** A saved proxy or the computer of a member, as one choice for a profile. */
export interface BrowserProxyChoice {
  id: string;
  name: string;
  /** Why the last page load through it failed, or null. */
  failure: BrowserProxyFailure | null;
  /** A computer whose app does not share its connection now. */
  offline: boolean;
  profileIds: readonly string[];
}

/** The name of a member's computer, as the panel shows it. */
export function browserComputerName(
  computer: Pick<BrowserProxyComputer, "mine" | "name">,
  t: ReturnType<typeof useText>["t"],
): string {
  if (computer.mine) return t("browser.proxies.yourComputer");
  return computer.name === null
    ? t("browser.proxies.unknownComputer")
    : t("browser.proxies.memberComputer", { name: computer.name });
}

/** The name of the proxy of each named profile, by profile id, as the panel shows it. */
export function browserProfileProxyNames(
  proxies: readonly (BrowserProxyNameParts & Pick<BrowserProxySummary, "profileIds">)[],
  computers: readonly Pick<BrowserProxyComputer, "mine" | "name" | "profileIds">[],
  t: ReturnType<typeof useText>["t"],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const proxy of proxies) for (const id of proxy.profileIds) names.set(id, browserProxyName(proxy, proxies));
  for (const computer of computers) {
    for (const id of computer.profileIds) names.set(id, browserComputerName(computer, t));
  }
  return names;
}

/** Each proxy and each computer, in the order the panel shows them. */
export function browserProxyChoices(
  proxies: BrowserProfileProxies,
  t: ReturnType<typeof useText>["t"],
): BrowserProxyChoice[] {
  return [
    ...proxies.list.map((proxy) => ({
      id: proxy.id,
      name: browserProxyName(proxy, proxies.list),
      failure: proxy.failure,
      offline: false,
      profileIds: proxy.profileIds,
    })),
    ...proxies.computers.map((computer) => ({
      id: computer.id,
      name: browserComputerName(computer, t),
      failure: computer.failure,
      offline: !computer.online,
      profileIds: computer.profileIds,
    })),
  ];
}

const AUTOMATIC = "automatic";

/**
 * Runs `next` after a menu closes. The menu gives the focus back to its trigger two frames after it
 * closes (focusRestoreHandler in @openbot/ui complex.tsx), so a dialog opens after that.
 */
export function createAfterMenuClose() {
  let afterClose: (() => void) | undefined;
  return {
    schedule: (next: () => void) => {
      afterClose = next;
    },
    onOpenChange: (open: boolean) => {
      const next = afterClose;
      afterClose = undefined;
      if (open || !next) return;
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(next)));
    },
  };
}

function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

/**
 * The "Proxy" submenu of a named profile: Automatic, each saved proxy and computer, a new proxy, and
 * this computer when this app can share its connection and the server does not have it yet.
 */
export function BrowserProxySubmenu(props: {
  choices: readonly BrowserProxyChoice[];
  /** The proxy of the profile, or null for Automatic. */
  value: string | null;
  mount: HTMLElement | undefined;
  onChange: (proxyId: string | null) => void;
  onNew: () => void;
  /** Absent when this app cannot add its computer. */
  onUseComputer?: (() => void) | undefined;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <Waypoints aria-hidden="true" />
        <span>{t("browser.proxies.menu")}</span>
        <ChevronRight class="browser-proxy-submenu-chevron" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.SubContent class="ui-action-menu" aria-label={t("browser.proxies.menu")}>
          <DropdownMenu.RadioGroup
            value={props.value ?? AUTOMATIC}
            onChange={(value) => props.onChange(value === AUTOMATIC ? null : value)}
          >
            <DropdownMenu.RadioItem value={AUTOMATIC} closeOnSelect>
              <MenuMark on={props.value === null} />
              {t("browser.proxies.automatic")}
            </DropdownMenu.RadioItem>
            <For each={props.choices}>
              {(choice) => (
                <DropdownMenu.RadioItem value={choice.id} closeOnSelect>
                  <MenuMark on={props.value === choice.id} />
                  <span title={choice.name}>{choice.name}</span>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => props.onNew()}>
            <Plus aria-hidden="true" />
            {t("browser.proxies.new")}
          </DropdownMenu.Item>
          <Show when={props.onUseComputer}>
            {(pick) => (
              <DropdownMenu.Item onSelect={() => pick()()}>
                <Monitor aria-hidden="true" />
                {t("browser.proxies.useComputer")}
              </DropdownMenu.Item>
            )}
          </Show>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/**
 * The proxy of a named profile, at the end of its row. It is red when the proxy does not answer or
 * refuses the sign-in, or when the computer of the profile does not share its connection now.
 */
export function BrowserProxyBadge(props: { proxy: BrowserProxyChoice }) {
  const { t } = useText();
  const problem = () => {
    if (props.proxy.offline) return t("browser.proxies.offlineBadge", { name: props.proxy.name });
    if (props.proxy.failure === "signIn") return t("browser.proxies.signInRefused", { name: props.proxy.name });
    return props.proxy.failure === "unreachable" ? t("browser.proxies.failing", { name: props.proxy.name }) : null;
  };
  return (
    <Show
      when={problem()}
      fallback={
        <Badge variant="info-light" class="browser-proxy-badge">
          <Waypoints aria-hidden="true" />
          {props.proxy.name}
        </Badge>
      }
    >
      {(text) => (
        <Badge variant="destructive-light" class="browser-proxy-badge">
          <Waypoints aria-hidden="true" />
          {text()}
        </Badge>
      )}
    </Show>
  );
}

/**
 * Asks before this app shares its internet connection with the server. Sharing stays on for the
 * server until the member stops it, and it works only while this app is open.
 */
export function BrowserComputerShareDialog(props: {
  open: boolean;
  error: JSX.Element | undefined;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useText();
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      icon={<Monitor />}
      title={t("browser.proxies.shareTitle")}
      description={t("browser.proxies.shareDescription")}
      confirmLabel={t("browser.proxies.share")}
      error={props.error}
      onCancel={() => props.onCancel()}
      onConfirm={() => props.onConfirm()}
    />
  );
}

/** Tells that a change closes open tabs. */
export function BrowserProxyClosesTabs(props: { count: number }) {
  const { t } = useText();
  return (
    <Show when={props.count > 0}>
      <Text variant="caption">{t("browser.proxies.closesTabs", { count: props.count })}</Text>
    </Show>
  );
}

/**
 * Adds or changes a proxy with one address field. A saved password shows as a mask: when the mask
 * stays, the password stays. `closesTabs`: the open tabs that the save closes. An edit that does not
 * change the address closes the dialog with no save, so it keeps the open tabs. `proxies`: the saved
 * proxies, to name the proxy as the list does.
 */
export function BrowserProxyDialog(props: {
  proxy: BrowserProxySummary | null;
  proxies: readonly BrowserProxySummary[];
  closesTabs: number;
  onSave: (address: string, keepPassword: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, errorMessage } = useText();
  const initial = untrack(() => editableBrowserProxyAddress(props.proxy));
  const [form, setForm] = createStore({ address: initial, error: "" });
  const changed = () => props.proxy === null || form.address.trim() !== initial;
  const closesTabs = () => (changed() ? props.closesTabs : 0);
  async function save(): Promise<void> {
    if (!changed()) {
      props.onCancel();
      return;
    }
    const parsed = parseBrowserProxyAddress(form.address);
    if (parsed === null) {
      setForm((draft) => {
        draft.error = t("error.backend.browserProxyAddressInvalid");
      });
      return;
    }
    const { address, keepPassword } = browserProxySaveAddress(props.proxy, parsed, form.address);
    try {
      await props.onSave(address, keepPassword);
    } catch (error) {
      setForm((draft) => {
        draft.error = errorMessage(error, t("browser.profiles.failed"));
      });
    }
  }
  const title = () => {
    const proxy = props.proxy;
    return proxy
      ? t("browser.proxies.editTitle", { name: browserProxyName(proxy, props.proxies) })
      : t("browser.proxies.addTitle");
  };
  return (
    <ConfirmDialog
      open={true}
      tone="default"
      icon={<Waypoints />}
      title={title()}
      description={t("browser.proxies.dialogDescription")}
      confirmLabel={t("common.save")}
      initialFocus="field"
      error={form.error || undefined}
      onCancel={() => props.onCancel()}
      onConfirm={save}
    >
      <BrowserProxyClosesTabs count={closesTabs()} />
      <Field label={t("browser.proxies.address")}>
        <Input
          value={form.address}
          placeholder={t("browser.proxies.addressPlaceholder")}
          spellcheck={false}
          autocomplete="off"
          maxlength={BROWSER_PROXY_ADDRESS_MAX}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.address = value;
              draft.error = "";
            })
          }
        />
      </Field>
    </ConfirmDialog>
  );
}

/** The saved proxies and the computers of the server, above its profiles. */
export function BrowserProxyList(props: {
  proxies: BrowserProfileProxies;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onAdd: () => void;
  onEdit: (proxy: BrowserProxySummary) => void;
  onDelete: (proxy: BrowserProxyChoice) => void;
  /** Asks before this app shares its connection. */
  onShare: () => void;
  onStopSharing: () => void;
}) {
  const { t } = useText();
  const choice = (proxy: BrowserProxySummary): BrowserProxyChoice => ({
    id: proxy.id,
    name: browserProxyName(proxy, props.proxies.list),
    failure: proxy.failure,
    offline: false,
    profileIds: proxy.profileIds,
  });
  return (
    <SettingsSection
      title={t("browser.proxies.title")}
      actions={
        <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onAdd()}>
          <Plus aria-hidden="true" />
          {t("browser.proxies.add")}
        </Button>
      }
    >
      <Show when={props.proxies.list.length > 0 || props.proxies.computers.length > 0}>
        <ItemGroup class="settings-modal-card" surface="subtle" aria-label={t("browser.proxies.title")}>
          <For each={props.proxies.list}>
            {(proxy) => (
              <Item>
                <ItemMedia class="browser-proxy-icon">
                  <Waypoints aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{choice(proxy).name}</ItemTitle>
                  <ItemDescription>
                    {t("browser.proxies.summary", {
                      scheme: proxy.scheme.toUpperCase(),
                      port: proxy.port,
                      profiles: t("browser.proxies.profiles", { count: proxy.profileIds.length }),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Show when={proxy.failure !== null}>
                    <BrowserProxyBadge proxy={choice(proxy)} />
                  </Show>
                  <BrowserProxyRowMenu
                    name={choice(proxy).name}
                    disabled={props.disabled}
                    mount={props.mount}
                    onEdit={() => props.onEdit(proxy)}
                    onDelete={() => props.onDelete(choice(proxy))}
                  />
                </ItemActions>
              </Item>
            )}
          </For>
          <For each={props.proxies.computers}>
            {(computer) => (
              <BrowserComputerRow
                computer={computer}
                sharing={computer.mine ? props.proxies.sharing : undefined}
                disabled={props.disabled}
                mount={props.mount}
                onShare={() => props.onShare()}
                onStopSharing={() => props.onStopSharing()}
                onDelete={(choice) => props.onDelete(choice)}
              />
            )}
          </For>
        </ItemGroup>
      </Show>
    </SettingsSection>
  );
}

/**
 * The computer of one member. The row of this member's own computer can stop or start the sharing
 * of this app's connection, when this app can share it.
 */
function BrowserComputerRow(props: {
  computer: BrowserProxyComputer;
  /** Undefined: not the computer of this app, or this app cannot share. */
  sharing: boolean | undefined;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onShare: () => void;
  onStopSharing: () => void;
  onDelete: (choice: BrowserProxyChoice) => void;
}) {
  const { t } = useText();
  const name = () => browserComputerName(props.computer, t);
  const choice = (): BrowserProxyChoice => ({
    id: props.computer.id,
    name: name(),
    failure: props.computer.failure,
    offline: !props.computer.online,
    profileIds: props.computer.profileIds,
  });
  return (
    <Item>
      <ItemMedia class="browser-proxy-icon">
        <Monitor aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{name()}</ItemTitle>
        <ItemDescription>
          {t("browser.proxies.computerSummary", {
            state: props.computer.online ? t("browser.proxies.online") : t("browser.proxies.offline"),
            profiles: t("browser.proxies.profiles", { count: props.computer.profileIds.length }),
          })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Show when={props.computer.online && props.computer.failure !== null}>
          <BrowserProxyBadge proxy={choice()} />
        </Show>
        <Show when={props.sharing !== undefined}>
          <Show
            when={props.sharing}
            fallback={
              <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onShare()}>
                {t("browser.proxies.share")}
              </Button>
            }
          >
            <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onStopSharing()}>
              {t("browser.proxies.stopSharing")}
            </Button>
          </Show>
        </Show>
        <BrowserProxyRowMenu
          name={name()}
          disabled={props.disabled}
          mount={props.mount}
          onDelete={() => props.onDelete(choice())}
        />
      </ItemActions>
    </Item>
  );
}

function BrowserProxyRowMenu(props: {
  name: string;
  disabled: boolean;
  mount: HTMLElement | undefined;
  /** Absent for a computer: it has no address to change. */
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const { t } = useText();
  const menu = createAfterMenuClose();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false} onOpenChange={menu.onOpenChange}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("browser.profiles.actionsFor", { name: props.name })}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <Show when={props.onEdit}>
            {(edit) => (
              <>
                <DropdownMenu.Item onSelect={() => menu.schedule(edit())}>
                  <Pencil aria-hidden="true" />
                  {t("common.edit")}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
              </>
            )}
          </Show>
          <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onDelete()}>
            <Trash2 aria-hidden="true" />
            {t("common.delete")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
