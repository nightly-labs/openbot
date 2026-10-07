import { DEFAULT_TEAM_MEMBER_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { InviteSummary, TeamPresenceMember, TeamRole } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  Card,
  Check,
  ConfirmDialog,
  CopyButton,
  DropdownMenu,
  Ellipsis,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  ShieldCheck,
  SlidingTabs,
  Text,
  Trash2,
  UserRound,
} from "@openbot/ui";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { serverRoleCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

type InviteMode = "link" | "email" | "perma";
type InviteRole = Exclude<TeamRole, "owner">;

const ROLE_OPTIONS: InviteRole[] = ["member", "admin"];
const ROLE_LABELS = {
  owner: "server.role.owner",
  admin: "server.role.admin",
  member: "server.role.member",
} as const satisfies Record<TeamRole, AppTextKey>;
const EMAIL_PLACEHOLDER = "person@company.com";

/** The invite composer. `mode` picks which of `email` and `link` the panel is filling in. */
interface InvitePanel {
  email: string;
  emailError: string | null;
  link: string;
  mode: InviteMode;
  result: InviteSummary | null;
  showQr: boolean;
  role: InviteRole;
}

interface MembersPanel {
  removeId: string | null;
  search: string;
}

/**
 * The Members section's state. Each group's fields are written together - switching invite mode
 * clears three of the composer's fields - so they are one store rather than a signal each, and
 * replacing one field re-renders only what read that field.
 */
interface MembersPanels {
  invite: InvitePanel;
  members: MembersPanel;
}

interface ServerMembersSection {
  Panel: () => JSX.Element;
  /** The member removal confirmation. It stays outside the panel so it keeps its place in the dialog. */
  RemoveDialog: () => JSX.Element;
  /** Forgets the invite and search of the previous server when the dialog shows another one. */
  resetForServer(): void;
}

/** The Members section: the invite composer, the member list, and the pending invites. */
export function createServerMembersSection(host: ServerSettingsSectionHost): ServerMembersSection {
  const { t, format } = useText();
  const { props, local, configured, published, actionsAvailable, busy, run } = host;
  const [panels, setPanels] = createStore<MembersPanels>({
    invite: {
      email: "",
      emailError: null,
      link: "",
      mode: "email",
      result: null,
      showQr: false,
      role: "member",
    },
    members: { removeId: null, search: "" },
  });
  /** A clock, not panel state: it retires an invite row as its `expiresAt` passes. */
  const [now, setNow] = createSignal(Date.now());
  let inviteLinkInput: HTMLInputElement | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let inviteLinkSwapTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Permanent links need a transport that carries the flag: local IPC or the account
   * plane. The frozen Team API projections strip it on legacy HTTP, where even two
   * updated peers would silently mint single-use, so the tab stays hidden there.
   */
  const permanentSupported = () => local() || props.server.apiUrl === null;
  const canManage = () => configured() && serverRoleCanAdminister(props.server);
  const activeInvites = createMemo(() =>
    props.invites.filter(
      (item) => (item.permanent || item.usedAt === null) && (item.permanent || Date.parse(item.expiresAt) > now()),
    ),
  );
  const inviteUsed = () =>
    Boolean(
      panels.invite.result &&
        !panels.invite.result.permanent &&
        props.invites.some((invite) => invite.id === panels.invite.result?.id && invite.usedAt),
    );
  const inviteExpired = () =>
    Boolean(
      panels.invite.result && !panels.invite.result.permanent && Date.parse(panels.invite.result.expiresAt) <= now(),
    );
  const activeMembers = createMemo(() => props.members.filter((member) => !member.disabled));
  /**
   * This host or the account plane applies the limit, from the host's plan. A legacy HTTP peer can be
   * a version without it.
   */
  const memberLimit = () => (permanentSupported() ? (props.server.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT) : null);
  const membersFull = () => {
    const limit = memberLimit();
    return limit !== null && activeMembers().length >= limit;
  };
  const membersCount = () => {
    const count = activeMembers().length;
    const limit = memberLimit();
    return limit === null ? t("server.members.count", { count }) : t("server.members.limitCount", { count, limit });
  };
  const inactiveLegacyMembers = createMemo(() =>
    props.server.kind === "remote" && /^https?:\/\//u.test(props.server.apiUrl ?? "")
      ? props.members.filter((member) => member.disabled && member.role !== "owner")
      : [],
  );
  const filteredMembers = createMemo(() => {
    const query = panels.members.search.trim().toLowerCase();
    if (!query) return activeMembers();
    return activeMembers().filter((member) =>
      [teamMemberName(member), member.email, member.username].some((value) => value?.toLowerCase().includes(query)),
    );
  });
  const removeMember = createMemo(() => props.members.find((member) => member.id === panels.members.removeId) ?? null);
  const canInvite = createMemo(
    () =>
      canManage() &&
      published() &&
      !membersFull() &&
      busy() === null &&
      (panels.invite.mode !== "email" || normalizeEmailAddress(panels.invite.email) !== null),
  );

  createEffect(
    () => ({ invites: props.invites, currentTime: now() }),
    ({ invites, currentTime }) => {
      const nextExpiry = untrack(
        () =>
          invites
            .filter((item) => !item.permanent && item.usedAt === null)
            .map((item) => Date.parse(item.expiresAt))
            .filter((value) => value > currentTime)
            .sort((left, right) => left - right)[0],
      );
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = nextExpiry
        ? setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - currentTime + 1, 2_147_483_647))
        : undefined;
    },
  );

  onCleanup(() => {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
  });

  function resetInviteLink(): void {
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
    inviteLinkSwapTimer = undefined;
    inviteLinkInput?.classList.remove("is-exit", "is-enter-start");
    setPanels((state) => {
      state.invite.link = "";
    });
  }

  function swapInviteLink(next: string): void {
    const element = inviteLinkInput;
    if (!element || prefersReducedMotion()) {
      setPanels((state) => {
        state.invite.link = next;
      });
      return;
    }
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
    const duration =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur")) || 150;
    element.classList.add("is-exit");
    inviteLinkSwapTimer = setTimeout(() => {
      inviteLinkSwapTimer = undefined;
      setPanels((state) => {
        state.invite.link = next;
      });
      element.classList.remove("is-exit");
      element.classList.add("is-enter-start");
      void element.offsetHeight;
      element.classList.remove("is-enter-start");
    }, duration);
  }

  async function createInvite(): Promise<void> {
    const email = panels.invite.mode === "email" ? normalizeEmailAddress(panels.invite.email) : null;
    if (panels.invite.mode === "email" && !email) {
      setPanels((state) => {
        state.invite.emailError = t("server.invite.invalidEmail");
      });
      return;
    }
    let result: InviteSummary | undefined;
    const role = panels.invite.role;
    const permanent = panels.invite.mode === "perma";
    const saved = await run("invite", async () => {
      result = await props.onCreateInvite({ role, ...(email ? { email } : {}), ...(permanent ? { permanent } : {}) });
    });
    if (!saved || !result) return;
    const created = result;
    setPanels((state) => {
      state.invite.result = created;
      state.invite.emailError = null;
      if (email) state.invite.email = "";
    });
    if (!created.email) swapInviteLink(created.inviteUrl);
  }

  function resetForServer(): void {
    setPanels((state) => {
      state.invite.result = null;
      state.invite.showQr = false;
      state.members.search = "";
    });
    resetInviteLink();
  }

  const inviteTabsProps = {
    get value() {
      return panels.invite.mode;
    },
    onChange(value: string) {
      if (value !== "link" && value !== "email" && value !== "perma") return;
      setPanels((state) => {
        state.invite.mode = value;
        state.invite.result = null;
        state.invite.showQr = false;
        state.invite.emailError = null;
      });
      resetInviteLink();
    },
  };

  function Panel() {
    return (
      <>
        <Show when={!configured() || !published()}>
          <Alert class="server-settings-members-alert" tone="warning" role="status">
            <AlertIcon>
              <ShieldCheck />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>
                {configured() ? t("server.members.invitationsPaused") : t("server.members.setupRequired")}
              </AlertTitle>
              <AlertDescription>
                {configured() ? t("server.members.publishToInvite") : t("server.members.saveIdentityFirst")}
              </AlertDescription>
            </AlertContent>
          </Alert>
        </Show>
        <Show when={canManage()}>{inviteComposer()}</Show>
        <SettingsSection
          class="server-settings-members-section"
          title={
            <span class="server-settings-members-title">
              {t("server.members.title")}
              <Badge variant={membersFull() ? "warning-light" : "secondary"}>{membersCount()}</Badge>
            </span>
          }
          actions={
            <label class="server-settings-search">
              <Search aria-hidden="true" />
              <span class="sr-only">{t("server.members.search")}</span>
              <Input
                size="sm"
                type="search"
                placeholder={t("server.members.search")}
                value={panels.members.search}
                onValueChange={(value) =>
                  setPanels((state) => {
                    state.members.search = value;
                  })
                }
              />
            </label>
          }
        >
          <ItemGroup class="settings-modal-card server-settings-members-list">
            <Show
              when={filteredMembers().length > 0}
              fallback={
                <Item class="server-settings-empty-row">
                  <ItemContent>
                    <ItemDescription>{t("server.members.noMatch")}</ItemDescription>
                  </ItemContent>
                </Item>
              }
            >
              <For each={filteredMembers()}>{(member) => memberRow(member)}</For>
            </Show>
          </ItemGroup>
        </SettingsSection>
        <Show when={canManage() && inactiveLegacyMembers().length > 0}>
          <SettingsSection
            title={t("server.members.inactiveTitle")}
            description={t("server.members.inactiveDescription")}
          >
            <ItemGroup class="settings-modal-card server-settings-members-list">
              <For each={inactiveLegacyMembers()}>{(member) => memberRow(member)}</For>
            </ItemGroup>
          </SettingsSection>
        </Show>
        <Show when={canManage()}>{pendingInvites()}</Show>
      </>
    );
  }

  function inviteComposer() {
    return (
      <SlidingTabs.Root {...inviteTabsProps}>
        <SettingsSection
          class="server-settings-invite-section"
          title={t("server.invite.title")}
          description={t("server.invite.description")}
          actions={
            <SlidingTabs.List aria-label={t("server.invite.method")}>
              <SlidingTabs.Trigger value="email">{t("server.invite.email")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="link">{t("server.invite.link")}</SlidingTabs.Trigger>
              <Show when={permanentSupported()}>
                <SlidingTabs.Trigger value="perma">{t("server.invite.permaLink")}</SlidingTabs.Trigger>
              </Show>
            </SlidingTabs.List>
          }
        >
          <Card class="server-settings-invite-card">
            <div class="server-settings-invite-composer">
              <SlidingTabs.ContentSlot>
                <SlidingTabs.Content value="email" class="server-settings-invite-mode-panel">
                  <Field
                    class="server-settings-invite-email-field"
                    label={t("server.invite.emailAddress")}
                    error={panels.invite.emailError}
                  >
                    <Input
                      size="md"
                      type="email"
                      autocomplete="email"
                      maxlength={INPUT_LIMITS.email}
                      disabled={!published()}
                      placeholder={EMAIL_PLACEHOLDER}
                      value={panels.invite.email}
                      onValueChange={(value) =>
                        setPanels((state) => {
                          state.invite.email = value;
                          state.invite.emailError = null;
                        })
                      }
                      onBlur={() =>
                        panels.invite.email &&
                        !normalizeEmailAddress(panels.invite.email) &&
                        setPanels((state) => {
                          state.invite.emailError = t("server.invite.invalidEmail");
                        })
                      }
                    />
                  </Field>
                </SlidingTabs.Content>
                <SlidingTabs.Content value="link" class="server-settings-invite-mode-panel">
                  <Input
                    ref={(element) => (inviteLinkInput = element)}
                    class="server-settings-invite-link-input t-text-swap"
                    size="md"
                    readonly
                    aria-label={t("server.invite.linkLabel")}
                    placeholder={t("server.invite.linkPlaceholder")}
                    value={panels.invite.link}
                    title={panels.invite.link || undefined}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </SlidingTabs.Content>
                <SlidingTabs.Content value="perma" class="server-settings-invite-mode-panel">
                  <Input
                    class="server-settings-invite-link-input"
                    size="md"
                    readonly
                    aria-label={t("server.invite.permanentLink")}
                    placeholder={t("server.invite.linkPlaceholder")}
                    value={panels.invite.link}
                    title={panels.invite.link || undefined}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </SlidingTabs.Content>
              </SlidingTabs.ContentSlot>
              <Select<InviteRole>
                options={ROLE_OPTIONS}
                value={panels.invite.role}
                disabled={!published()}
                placement="bottom-end"
                onChange={(value) =>
                  value &&
                  setPanels((state) => {
                    state.invite.role = value;
                  })
                }
                itemComponent={(item) => <SelectItem item={item.item}>{t(ROLE_LABELS[item.item.rawValue])}</SelectItem>}
              >
                <SelectTrigger class="server-settings-role-select" size="sm" aria-label={t("server.invite.role")}>
                  <SelectValue<InviteRole>>{(state) => t(ROLE_LABELS[state.selectedOption()])}</SelectValue>
                </SelectTrigger>
                <SelectContent mount={host.menuMount()} />
              </Select>
              <Show
                when={
                  panels.invite.mode !== "email" && panels.invite.result && !panels.invite.result.email
                    ? panels.invite.result
                    : null
                }
                fallback={
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    loading={busy() === "invite"}
                    disabled={!canInvite()}
                    onClick={() => void createInvite()}
                  >
                    {panels.invite.mode === "email" ? t("server.invite.send") : t("server.invite.createLink")}
                  </Button>
                }
              >
                {(result) => (
                  <div class="server-settings-invite-share">
                    <Button
                      size="sm"
                      variant="ghost"
                      class="server-settings-invite-new-link"
                      aria-label={t("server.invite.createNewLinkLabel")}
                      title={t("server.invite.createNewLink")}
                      loading={busy() === "invite"}
                      disabled={!canInvite()}
                      onClick={() => void createInvite()}
                    >
                      <RefreshCw />
                      {t("server.invite.newLink")}
                    </Button>
                    <Show when={!inviteUsed() && !inviteExpired()}>
                      <CopyButton
                        class="server-settings-invite-copy"
                        value={result().inviteUrl}
                        label={t("server.invite.copyLink")}
                        copiedLabel={t("common.copied")}
                        size="sm"
                        variant="default"
                        onCopyError={host.showCopyError}
                      />
                      <Button
                        size="icon-sm"
                        variant="default"
                        aria-label={t("server.invite.showQr")}
                        aria-expanded={panels.invite.showQr ? "true" : "false"}
                        onClick={() =>
                          setPanels((state) => {
                            state.invite.showQr = !state.invite.showQr;
                          })
                        }
                      >
                        <ScanLine />
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
            <Show when={panels.invite.mode === "perma" && !membersFull()}>
              <Text variant="caption" tone="muted" class="server-settings-invite-hint">
                {t("server.invite.permaHint")}
              </Text>
            </Show>
            <Show when={membersFull()}>
              <Text variant="caption" tone="muted" class="server-settings-invite-hint">
                {t("server.invite.full", { limit: memberLimit() ?? DEFAULT_TEAM_MEMBER_LIMIT })}
              </Text>
            </Show>
            <Show
              when={
                panels.invite.showQr &&
                !inviteUsed() &&
                !inviteExpired() &&
                panels.invite.mode !== "email" &&
                panels.invite.result
              }
            >
              {(result) => (
                <div class="server-settings-invite-qr">
                  <QrCode value={result().inviteUrl} label={t("server.invite.qrLabel")} />
                  <Text variant="caption" tone="muted">
                    {t("server.invite.qrDescription")}
                  </Text>
                </div>
              )}
            </Show>
            <Show when={panels.invite.result && !panels.invite.result.permanent ? panels.invite.result : null}>
              {(result) => (
                <Alert class="server-settings-invite-result" tone="success" role="status">
                  <AlertIcon>
                    <Check />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>
                      {inviteUsed()
                        ? t("server.invite.accepted")
                        : inviteExpired()
                          ? t("server.invite.expired")
                          : result().email
                            ? t("server.invite.sent")
                            : t("server.invite.linkReady")}
                    </AlertTitle>
                    <AlertDescription>
                      {inviteUsed()
                        ? t("server.invite.acceptedDescription")
                        : inviteExpired()
                          ? t("server.invite.expiredDescription")
                          : result().email || t("server.invite.linkReadyDescription")}
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </Show>
          </Card>
        </SettingsSection>
      </SlidingTabs.Root>
    );
  }

  function memberRow(member: TeamPresenceMember) {
    return (
      <Item class="server-settings-member-row" data-disabled={member.disabled ? "" : undefined}>
        <ItemContent>
          <ItemTitle>{teamMemberName(member)}</ItemTitle>
          <ItemDescription class="server-settings-member-meta">{member.email ?? member.username}</ItemDescription>
        </ItemContent>
        <ItemActions class="server-settings-member-actions">
          <Show when={member.role !== "owner"} fallback={<Badge variant="primary-light">{t(ROLE_LABELS.owner)}</Badge>}>
            <Text variant="label-sm" tone="secondary">
              {t(ROLE_LABELS[member.role])}
            </Text>
            <Show when={canManage() && actionsAvailable()}>
              <MemberActionsMenu
                member={member}
                mount={host.menuMount()}
                onRoleChange={(role) =>
                  void run(`member:${member.id}`, () => props.onUpdateMember({ memberId: member.id, role }))
                }
                onRemove={(trigger) => {
                  // The confirmation returns focus to the element focused when it opens.
                  trigger.focus({ preventScroll: true });
                  setPanels((state) => {
                    state.members.removeId = member.id;
                  });
                }}
              />
            </Show>
          </Show>
        </ItemActions>
      </Item>
    );
  }

  function pendingInvites() {
    return (
      <SettingsSection
        title={t("server.invite.pendingTitle")}
        actions={
          <Text variant="caption" tone="muted">
            {t("server.invite.pendingCount", { total: activeInvites().length })}
          </Text>
        }
      >
        <ItemGroup class="settings-modal-card server-settings-invites-list">
          <Show
            when={activeInvites().length > 0}
            fallback={
              <Item class="server-settings-empty-row">
                <ItemContent>
                  <ItemDescription>{t("server.invite.noPending")}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <For each={activeInvites()}>
              {(invite) => (
                <Item class="server-settings-invite-row">
                  <ItemContent>
                    <ItemTitle>
                      {invite.email ??
                        (invite.permanent ? t("server.invite.permanentLink") : t("server.invite.privateLink"))}
                    </ItemTitle>
                    <ItemDescription>
                      {t(ROLE_LABELS[invite.role])} ·{" "}
                      {invite.permanent
                        ? t("server.invite.neverExpires", { count: invite.useCount })
                        : t("server.invite.expires", {
                            date: format.date(new Date(invite.expiresAt), {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive-ghost"
                      disabled={!actionsAvailable() || Boolean(busy())}
                      onClick={() => void run(`invite:${invite.id}`, () => props.onRevokeInvite(invite.id))}
                    >
                      {t("server.invite.revoke")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </Show>
        </ItemGroup>
      </SettingsSection>
    );
  }

  function RemoveDialog() {
    // The dialog unmounts with its target, so its title never shows an empty name while it closes.
    return (
      <Show when={removeMember()}>
        {(member) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            pending={busy() === `remove:${member().id}`}
            title={t("server.members.removeTitle", { name: teamMemberName(member()) })}
            description={t("server.members.removeDescription")}
            confirmLabel={t("server.members.remove")}
            pendingLabel={t("common.removing")}
            onCancel={() =>
              setPanels((state) => {
                state.members.removeId = null;
              })
            }
            onConfirm={async () => {
              await run(`remove:${member().id}`, async () => {
                await props.onRemoveMember(member().id);
                setPanels((state) => {
                  state.members.removeId = null;
                });
              });
            }}
          />
        )}
      </Show>
    );
  }

  return { Panel, RemoveDialog, resetForServer };
}

function MemberActionsMenu(props: {
  member: TeamPresenceMember;
  mount: HTMLElement | undefined;
  onRoleChange: (role: InviteRole) => void;
  onRemove: (trigger: HTMLElement) => void;
}) {
  const { t } = useText();
  const name = () => teamMemberName(props.member);
  let triggerElement: HTMLElement | undefined;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        ref={(element) => (triggerElement = element)}
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button server-settings-member-menu-trigger`}
        aria-label={t("server.members.actionsFor", { name: name() })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      {/* A portal without a mount uses the document body. */}
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content class="server-settings-member-menu">
          <Show when={!props.member.disabled}>
            <DropdownMenu.Item onSelect={() => props.onRoleChange(props.member.role === "admin" ? "member" : "admin")}>
              {props.member.role === "admin" ? <UserRound aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {props.member.role === "admin" ? t("server.members.makeMember") : t("server.members.makeAdmin")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          </Show>
          <DropdownMenu.Item
            class="ui-action-menu-danger"
            onSelect={() => triggerElement && props.onRemove(triggerElement)}
          >
            <Trash2 aria-hidden="true" />
            {t("server.members.remove")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
