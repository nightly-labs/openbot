import { type AvatarHue, BROWSER_PROFILE_NAME_MAX, type BrowserProfileSummary } from "@openbot/contracts/ipc";
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
  Text,
  Trash2,
} from "@openbot/ui";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createStore, For, Show } from "solid-js";
import { useText } from "../../text";
import { BrowserProfileColorMenu, BrowserProfileDot } from "./BrowserProfileColor";

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
}

interface BrowserProfilesDraft {
  newName: string;
  renaming: { id: string; name: string } | null;
  confirming: { kind: "clear" | "delete"; profile: BrowserProfileSummary } | null;
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

  return (
    <div class="browser-profiles-panel" aria-busy={draft.busy ? "true" : undefined}>
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
                          <BrowserProfileRowMenu
                            name={profile.name}
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
      <Show when={!draft.confirming && draft.failure}>
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
    </div>
  );
}

function BrowserProfileRowMenu(props: {
  name: string;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { t } = useText();
  // Rename puts a field in place of the row. The menu gives the focus back to its trigger two frames
  // after it closes (focusRestoreHandler in @openbot/ui complex.tsx), so the field opens after that.
  let afterClose: (() => void) | undefined;
  return (
    <DropdownMenu.Root
      placement="bottom-end"
      gutter={4}
      modal={false}
      onOpenChange={(open) => {
        const next = afterClose;
        afterClose = undefined;
        if (open || !next) return;
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(next)));
      }}
    >
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("browser.profiles.actionsFor", { name: props.name })}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={() => (afterClose = props.onRename)}>
            <Pencil aria-hidden="true" />
            {t("common.rename")}
          </DropdownMenu.Item>
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
