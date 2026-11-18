import {
  type AvatarHue,
  BROWSER_PROFILE_NAME_MAX,
  type BrowserProfileSummary,
  type BrowserProxySummary,
  browserProxyAddressText,
} from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  ErrorReference,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  LogOut,
  Pencil,
  Plus,
  SettingsSection,
  Text,
  Trash2,
  Waypoints,
} from "@openbot/ui";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import type { JSX } from "@solidjs/web";
import { createStore, For, Show } from "solid-js";
import { useText } from "../../text";
import { BrowserProfileColorMenu, BrowserProfileDot } from "./BrowserProfileColor";
import {
  BrowserComputerShareDialog,
  type BrowserProfileProxies,
  BrowserProxyBadge,
  type BrowserProxyChoice,
  BrowserProxyClosesTabs,
  BrowserProxyDialog,
  type BrowserProxyDraft,
  BrowserProxyList,
  BrowserProxySubmenu,
  browserProxyChoices,
  createAfterMenuClose,
} from "./BrowserProxies";

export interface BrowserProfilesPanelProps {
  /** Undefined while the profiles load. */
  profiles: readonly BrowserProfileSummary[] | undefined;
  /** The agents that use the shared profile. Undefined while they load. */
  sharedAgentCount: number | undefined;
  /** The name of an agent, for the delete question. Undefined for an agent this window does not show. */
  agentName: (agentId: string) => string | undefined;
  onCreate: (name: string) => Promise<void>;
  onRename: (profileId: string, name: string) => Promise<void>;
  onRecolor: (profileId: string, hue: AvatarHue) => Promise<void>;
  /** Closes the tabs of the profile and deletes its cookies and site data. */
  onClear: (profileId: string) => Promise<void>;
  /** Moves the agents of the profile to the shared profile, closes its tabs and deletes its data. */
  onDelete: (profileId: string) => Promise<void>;
  /** Where the row menus open, so they stay inside the settings page. */
  menuMount?: HTMLElement | undefined;
  /** The saved proxies, when the server has proxy routes. Undefined hides the proxy choice. */
  proxies?: BrowserProfileProxies | undefined;
}

interface BrowserProfilesDraft {
  newName: string;
  renaming: { id: string; name: string } | null;
  confirming: { kind: "clear" | "delete"; profile: BrowserProfileSummary } | null;
  /**
   * The proxy dialog. `previousAddress`: the address of the proxy when the dialog opened, as the host
   * checks it on save. `assignTo`: the named profile that uses a new proxy at once.
   */
  editingProxy: { proxy: BrowserProxySummary | null; previousAddress: string | null; assignTo: string | null } | null;
  /** The proxy to delete, with the profiles that used it when the question opened. */
  deletingProxy: BrowserProxyChoice | null;
  /** A proxy change of a profile with open tabs: the change closes them, so it asks first. */
  changingProxy: { profile: BrowserProfileSummary; proxyId: string | null } | null;
  /** The share question. `assignTo`: the named profile that uses this computer at once. */
  sharing: { assignTo: string | null } | null;
  busy: boolean;
  failure: UserErrorDetails | null;
}

/**
 * The browser profiles of the computer that runs the agents, in its server settings. The shared
 * profile comes first and has no menu: it cannot be renamed or deleted. Each named profile has its
 * color and one menu: rename, clear and delete. A profile name is user data, so it shows only
 * here and in the labels the user reads.
 */
export function BrowserProfilesPanel(props: BrowserProfilesPanelProps) {
  const { t, errorMessage, format } = useText();
  const [draft, setDraft] = createStore<BrowserProfilesDraft>({
    newName: "",
    renaming: null,
    confirming: null,
    editingProxy: null,
    deletingProxy: null,
    changingProxy: null,
    sharing: null,
    busy: false,
    failure: null,
  });

  /** Runs one change. A failure stays in the panel; the store keeps the last list. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setDraft((state) => {
      state.busy = true;
      state.failure = null;
    });
    try {
      await action();
      return true;
    } catch (error) {
      setDraft((state) => {
        state.failure = {
          message: errorMessage(error, t("browser.profiles.failed")),
          reference: errorReference(error),
        };
      });
      return false;
    } finally {
      setDraft((state) => {
        state.busy = false;
      });
    }
  }

  async function create(): Promise<void> {
    const name = draft.newName.trim();
    if (!name || draft.busy) return;
    if (await run(() => props.onCreate(name)))
      setDraft((state) => {
        state.newName = "";
      });
  }

  async function rename(): Promise<void> {
    const renaming = draft.renaming;
    const name = renaming?.name.trim();
    if (!renaming || !name || draft.busy) return;
    if (await run(() => props.onRename(renaming.id, name)))
      setDraft((state) => {
        state.renaming = null;
      });
  }

  async function confirm(): Promise<void> {
    const confirming = draft.confirming;
    if (!confirming) return;
    const done = await run(() =>
      confirming.kind === "clear" ? props.onClear(confirming.profile.id) : props.onDelete(confirming.profile.id),
    );
    if (done)
      setDraft((state) => {
        state.confirming = null;
      });
  }

  async function saveProxy(proxies: BrowserProfileProxies, address: string, keepPassword: boolean): Promise<void> {
    const editing = draft.editingProxy;
    if (!editing) return;
    const change: BrowserProxyDraft = { address };
    if (editing.proxy) change.proxyId = editing.proxy.id;
    if (editing.previousAddress !== null) change.previousAddress = editing.previousAddress;
    if (keepPassword) change.keepPassword = true;
    if (editing.assignTo !== null) change.assignTo = editing.assignTo;
    await proxies.onSave(change);
    setDraft((state) => {
      state.editingProxy = null;
    });
  }

  async function changeProxy(): Promise<void> {
    const changing = draft.changingProxy;
    const proxies = props.proxies;
    if (!changing || !proxies) return;
    if (await run(() => proxies.onSetProfileProxy(changing.profile.id, changing.proxyId)))
      setDraft((state) => {
        state.changingProxy = null;
      });
  }

  /** The open tabs of these named profiles: a proxy change closes them. */
  const openTabs = (profileIds: readonly string[]) =>
    (props.profiles ?? []).reduce(
      (count, profile) => (profileIds.includes(profile.id) ? count + profile.tabCount : count),
      0,
    );

  const editedProfiles = (): readonly string[] => {
    const editing = draft.editingProxy;
    if (!editing) return [];
    return editing.proxy ? editing.proxy.profileIds : editing.assignTo === null ? [] : [editing.assignTo];
  };

  async function deleteProxy(): Promise<void> {
    const proxy = draft.deletingProxy;
    const proxies = props.proxies;
    if (!proxy || !proxies) return;
    if (await run(() => proxies.onDelete(proxy.id, proxy.profileIds)))
      setDraft((state) => {
        state.deletingProxy = null;
      });
  }

  const openProxyDialog = (proxy: BrowserProxySummary | null, assignTo: string | null) =>
    setDraft((state) => {
      state.failure = null;
      state.editingProxy = { proxy, previousAddress: proxy ? browserProxyAddressText(proxy) : null, assignTo };
    });

  const choices = (): BrowserProxyChoice[] => (props.proxies ? browserProxyChoices(props.proxies, t) : []);
  const proxyOf = (profileId: string) => choices().find((proxy) => proxy.profileIds.includes(profileId));
  const myComputer = () => props.proxies?.computers.find((computer) => computer.mine);

  const askToShare = (assignTo: string | null) =>
    setDraft((state) => {
      state.failure = null;
      state.sharing = { assignTo };
    });

  async function share(): Promise<void> {
    const asked = draft.sharing;
    const onSetSharing = props.proxies?.onSetSharing;
    if (!asked || !onSetSharing) return;
    const done = await run(() => (asked.assignTo === null ? onSetSharing(true) : onSetSharing(true, asked.assignTo)));
    if (done)
      setDraft((state) => {
        state.sharing = null;
      });
  }

  const dialogError = (open: boolean): JSX.Element | undefined => {
    const failure = open ? draft.failure : null;
    if (!failure) return undefined;
    return (
      <>
        {failure.message}
        <ErrorReference reference={failure.reference} />
      </>
    );
  };

  const deleteProxyDescription = () => {
    const count = draft.deletingProxy?.profileIds.length ?? 0;
    if (count === 0) return t("browser.proxies.deleteUnused");
    return t("browser.proxies.deleteUsed", { count });
  };

  const usage = (profile: BrowserProfileSummary) =>
    t("browser.profiles.usage", {
      agents: t("browser.profiles.agents", { count: profile.agentIds.length }),
      tabs: t("browser.profiles.tabs", { count: profile.tabCount }),
    });

  const deletedAgents = () => {
    const confirming = draft.confirming;
    if (confirming?.kind !== "delete") return [];
    return confirming.profile.agentIds.flatMap((agentId) => props.agentName(agentId) ?? []);
  };

  /** The proxy menu of a named profile, or undefined when the server has no proxy routes. */
  const rowProxy = (profile: BrowserProfileSummary): BrowserProfileRowProxy | undefined => {
    const proxies = props.proxies;
    if (!proxies) return undefined;
    const canShare = proxies.sharing !== undefined && proxies.onSetSharing !== undefined;
    return {
      choices: choices(),
      value: proxyOf(profile.id)?.id ?? null,
      onChange: (proxyId) => {
        // This computer, while it does not share: ask first, then share and use it.
        if (canShare && proxyId !== null && proxyId === myComputer()?.id && proxies.sharing === false)
          return askToShare(profile.id);
        if (profile.tabCount > 0)
          return setDraft((state) => {
            state.failure = null;
            state.changingProxy = { profile, proxyId };
          });
        void run(() => proxies.onSetProfileProxy(profile.id, proxyId));
      },
      onNew: () => openProxyDialog(null, profile.id),
      onUseComputer: canShare && !myComputer() ? () => askToShare(profile.id) : undefined,
    };
  };

  const ProfileList = (): JSX.Element => (
    <>
      <Show when={props.profiles}>
        {(profiles) => (
          <ItemGroup class="settings-modal-card" surface="subtle" aria-label={t("browser.profiles.label")}>
            <Item>
              <ItemMedia>
                <span class="browser-profile-color-trigger browser-profile-shared-mark">
                  <BrowserProfileDot hue="shared" />
                </span>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t("agentSettings.browserProfile.shared")}</ItemTitle>
                <Show when={props.sharedAgentCount}>
                  {(count) => <ItemDescription>{t("browser.profiles.agents", { count: count() })}</ItemDescription>}
                </Show>
              </ItemContent>
            </Item>
            <For each={profiles()}>
              {(profile) => (
                <Item>
                  <ItemMedia>
                    <BrowserProfileColorMenu
                      name={profile.name}
                      hue={profile.hue}
                      disabled={draft.busy}
                      mount={props.menuMount}
                      onChange={(hue) => void run(() => props.onRecolor(profile.id, hue))}
                    />
                  </ItemMedia>
                  <Show
                    when={draft.renaming?.id === profile.id ? draft.renaming : undefined}
                    fallback={
                      <>
                        <ItemContent>
                          <ItemTitle>{profile.name}</ItemTitle>
                          <ItemDescription>{usage(profile)}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Show when={proxyOf(profile.id)}>{(proxy) => <BrowserProxyBadge proxy={proxy()} />}</Show>
                          <BrowserProfileRowMenu
                            name={profile.name}
                            proxy={rowProxy(profile)}
                            disabled={draft.busy}
                            mount={props.menuMount}
                            onRename={() =>
                              setDraft((state) => {
                                state.renaming = { id: profile.id, name: profile.name };
                              })
                            }
                            onClear={() =>
                              setDraft((state) => {
                                state.confirming = { kind: "clear", profile };
                              })
                            }
                            onDelete={() =>
                              setDraft((state) => {
                                state.confirming = { kind: "delete", profile };
                              })
                            }
                          />
                        </ItemActions>
                      </>
                    }
                  >
                    {(renaming) => (
                      <form
                        class="browser-profiles-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void rename();
                        }}
                      >
                        <Input
                          ref={(element) => requestAnimationFrame(() => element.focus())}
                          class="browser-profiles-name"
                          size="sm"
                          value={renaming().name}
                          aria-label={t("browser.profiles.renameLabel", { name: profile.name })}
                          maxlength={BROWSER_PROFILE_NAME_MAX}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape") return;
                            event.preventDefault();
                            event.stopPropagation();
                            setDraft((state) => {
                              state.renaming = null;
                            });
                          }}
                          onValueChange={(value) =>
                            setDraft((state) => {
                              if (state.renaming) state.renaming.name = value;
                            })
                          }
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={draft.busy || !renaming().name.trim()}
                        >
                          {t("browser.profiles.save")}
                        </Button>
                      </form>
                    )}
                  </Show>
                </Item>
              )}
            </For>
          </ItemGroup>
        )}
      </Show>
      <form
        class="browser-profiles-row"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          class="browser-profiles-name"
          value={draft.newName}
          aria-label={t("browser.profiles.newName")}
          placeholder={t("browser.profiles.newName")}
          maxlength={BROWSER_PROFILE_NAME_MAX}
          onValueChange={(value) =>
            setDraft((state) => {
              state.newName = value;
            })
          }
        />
        <Button type="submit" variant="outline" disabled={draft.busy || !draft.newName.trim()}>
          <Plus aria-hidden="true" />
          {t("browser.profiles.create")}
        </Button>
      </form>
    </>
  );

  return (
    <div class="browser-profiles-panel" aria-busy={draft.busy ? "true" : undefined}>
      <Show when={props.proxies} fallback={<ProfileList />}>
        {(proxies) => (
          <>
            <BrowserProxyList
              proxies={proxies()}
              disabled={draft.busy}
              mount={props.menuMount}
              onAdd={() => openProxyDialog(null, null)}
              onEdit={(proxy) => openProxyDialog(proxy, null)}
              onDelete={(proxy) =>
                setDraft((state) => {
                  state.failure = null;
                  state.deletingProxy = { ...proxy, profileIds: [...proxy.profileIds] };
                })
              }
              onShare={() => askToShare(null)}
              onStopSharing={() => void run(() => proxies().onSetSharing?.(false) ?? Promise.resolve())}
            />
            <SettingsSection title={t("browser.profiles.sectionTitle")}>
              <ProfileList />
            </SettingsSection>
          </>
        )}
      </Show>
      <Show when={!draft.confirming && !draft.deletingProxy && !draft.changingProxy && !draft.sharing && draft.failure}>
        {(failure) => (
          <Text tone="danger" variant="caption" role="alert">
            {failure().message}
            <ErrorReference reference={failure().reference} />
          </Text>
        )}
      </Show>
      <ConfirmDialog
        open={draft.confirming !== null}
        title={
          draft.confirming?.kind === "clear"
            ? t("browser.profiles.clearTitle", { name: draft.confirming.profile.name })
            : t("browser.profiles.deleteTitle", { name: draft.confirming?.profile.name ?? "" })
        }
        description={
          draft.confirming?.kind === "clear"
            ? t("browser.profiles.clearDescription")
            : t("browser.profiles.deleteDescription")
        }
        confirmLabel={draft.confirming?.kind === "clear" ? t("browser.profiles.clear") : t("common.delete")}
        error={
          draft.confirming && draft.failure ? (
            <>
              {draft.failure.message}
              <ErrorReference reference={draft.failure.reference} />
            </>
          ) : undefined
        }
        onCancel={() =>
          setDraft((state) => {
            state.confirming = null;
            state.failure = null;
          })
        }
        onConfirm={confirm}
      >
        <Show when={deletedAgents().length > 0}>
          <Text variant="caption">{t("browser.profiles.deleteAgents", { agents: format.list(deletedAgents()) })}</Text>
        </Show>
      </ConfirmDialog>
      <Show when={props.proxies}>
        {(proxies) => (
          <>
            <Show when={draft.editingProxy}>
              {(editing) => (
                <BrowserProxyDialog
                  proxy={editing().proxy}
                  proxies={proxies().list}
                  closesTabs={openTabs(editedProfiles())}
                  onSave={(address, keepPassword) => saveProxy(proxies(), address, keepPassword)}
                  onCancel={() =>
                    setDraft((state) => {
                      state.editingProxy = null;
                    })
                  }
                />
              )}
            </Show>
            <ConfirmDialog
              open={draft.deletingProxy !== null}
              title={t("browser.profiles.deleteTitle", { name: draft.deletingProxy?.name ?? "" })}
              description={deleteProxyDescription()}
              confirmLabel={t("common.delete")}
              error={dialogError(draft.deletingProxy !== null)}
              onCancel={() =>
                setDraft((state) => {
                  state.deletingProxy = null;
                  state.failure = null;
                })
              }
              onConfirm={deleteProxy}
            >
              <BrowserProxyClosesTabs count={openTabs(draft.deletingProxy?.profileIds ?? [])} />
            </ConfirmDialog>
            <ConfirmDialog
              open={draft.changingProxy !== null}
              tone="default"
              icon={<Waypoints />}
              title={t("browser.proxies.changeTitle", { name: draft.changingProxy?.profile.name ?? "" })}
              description={t("browser.proxies.closesTabs", { count: draft.changingProxy?.profile.tabCount ?? 0 })}
              confirmLabel={t("browser.proxies.change")}
              error={dialogError(draft.changingProxy !== null)}
              onCancel={() =>
                setDraft((state) => {
                  state.changingProxy = null;
                  state.failure = null;
                })
              }
              onConfirm={changeProxy}
            />
            <BrowserComputerShareDialog
              open={draft.sharing !== null}
              error={dialogError(draft.sharing !== null)}
              onCancel={() =>
                setDraft((state) => {
                  state.sharing = null;
                  state.failure = null;
                })
              }
              onConfirm={share}
            />
          </>
        )}
      </Show>
    </div>
  );
}

interface BrowserProfileRowProxy {
  choices: readonly BrowserProxyChoice[];
  value: string | null;
  onChange: (proxyId: string | null) => void;
  onNew: () => void;
  onUseComputer: (() => void) | undefined;
}

function BrowserProfileRowMenu(props: {
  name: string;
  proxy: BrowserProfileRowProxy | undefined;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { t } = useText();
  // Rename puts a field in place of the row, and "New proxy…" opens a dialog: both after the menu
  // gives the focus back to its trigger.
  const menu = createAfterMenuClose();
  // The share question opens after the menu, as a dialog does.
  function computerAction(proxy: BrowserProfileRowProxy): (() => void) | undefined {
    const next = proxy.onUseComputer;
    if (!next) return undefined;
    return () => menu.schedule(next);
  }
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
          <DropdownMenu.Item onSelect={() => menu.schedule(props.onRename)}>
            <Pencil aria-hidden="true" />
            {t("common.rename")}
          </DropdownMenu.Item>
          <Show when={props.proxy}>
            {(proxy) => (
              <BrowserProxySubmenu
                choices={proxy().choices}
                value={proxy().value}
                mount={props.mount}
                onChange={(proxyId) => proxy().onChange(proxyId)}
                onNew={() => menu.schedule(() => proxy().onNew())}
                onUseComputer={computerAction(proxy())}
              />
            )}
          </Show>
          <DropdownMenu.Item onSelect={() => props.onClear()}>
            <LogOut aria-hidden="true" />
            {t("browser.profiles.clear")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onDelete()}>
            <Trash2 aria-hidden="true" />
            {t("common.delete")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
