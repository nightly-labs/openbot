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

export interface BrowserProxyDraft {
  proxyId?: string;
  previousAddress?: string;
  keepPassword?: boolean;
  address: string;
  assignTo?: string;
}

export interface BrowserProfileProxies {
  list: readonly BrowserProxySummary[];
  computers: readonly BrowserProxyComputer[];
  sharing?: boolean | undefined;
  onSave: (draft: BrowserProxyDraft) => Promise<void>;
  onDelete: (proxyId: string, profileIds: readonly string[]) => Promise<void>;
  onSetProfileProxy: (profileId: string, proxyId: string | null) => Promise<void>;
  onSetSharing?: (sharing: boolean, assignTo?: string) => Promise<void>;
}

export interface BrowserProxyChoice {
  id: string;
  name: string;
  failure: BrowserProxyFailure | null;
  offline: boolean;
  profileIds: readonly string[];
}

export function browserComputerName(
  computer: Pick<BrowserProxyComputer, "mine" | "name">,
  t: ReturnType<typeof useText>["t"],
): string {
  if (computer.mine) return t("browser.proxies.yourComputer");
  return computer.name === null
    ? t("browser.proxies.unknownComputer")
    : t("browser.proxies.memberComputer", { name: computer.name });
}

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

export function BrowserProxySubmenu(props: {
  choices: readonly BrowserProxyChoice[];
  value: string | null;
  mount: HTMLElement | undefined;
  onChange: (proxyId: string | null) => void;
  onNew: () => void;
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

export function BrowserProxyClosesTabs(props: { count: number }) {
  const { t } = useText();
  return (
    <Show when={props.count > 0}>
      <Text variant="caption">{t("browser.proxies.closesTabs", { count: props.count })}</Text>
    </Show>
  );
}

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

export function BrowserProxyList(props: {
  proxies: BrowserProfileProxies;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onAdd: () => void;
  onEdit: (proxy: BrowserProxySummary) => void;
  onDelete: (proxy: BrowserProxyChoice) => void;
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

function BrowserComputerRow(props: {
  computer: BrowserProxyComputer;
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
