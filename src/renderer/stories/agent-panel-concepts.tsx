import {
  Bell,
  Brain,
  Button,
  buttonVariants,
  ChartArea,
  Check,
  ChevronDown,
  ChevronRight,
  DropdownMenu,
  Ellipsis,
  Folder,
  FolderOpen,
  Hash,
  IconButton,
  Input,
  MemoryStick,
  MessageCircle,
  Monitor,
  Pencil,
  Puzzle,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  SlidingTabs,
  Switch,
  Tabs,
  Textarea,
  UserRound,
  Workflow,
} from "@openbot/ui";
import { SettingsBackIcon, SettingsField, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { STORY_AGENT } from "./fixtures";

// Concept only. The copy is literal on purpose: a direction is chosen first, and the real
// panel then gets catalog keys. Every concept shows the same settings as the shipped panel:
// identity, instructions, the six links, the runtime rows, the three switches and a new chat.

export const AGENT = STORY_AGENT;

/* ---------------------------------------------------------------- data */

export type DetailPage =
  | "profile"
  | "instructions"
  | "model"
  | "permissions"
  | "advanced"
  | "memories"
  | "skills"
  | "files"
  | "tables"
  | "routines"
  | "usage";

interface LinkSpec {
  page: DetailPage;
  label: string;
  value: string;
  icon: () => JSX.Element;
}

const KNOWLEDGE_LINKS: LinkSpec[] = [
  { page: "memories", label: "Memories", value: "3", icon: () => <MemoryStick aria-hidden="true" /> },
  { page: "skills", label: "Skills", value: "5", icon: () => <Puzzle aria-hidden="true" /> },
  { page: "files", label: "Files", value: "120 MB", icon: () => <Folder aria-hidden="true" /> },
  { page: "tables", label: "Tables", value: "2", icon: () => <Hash aria-hidden="true" /> },
];

const ACTIVITY_LINKS: LinkSpec[] = [
  { page: "routines", label: "Routines", value: "2 on", icon: () => <Workflow aria-hidden="true" /> },
  { page: "usage", label: "Usage", value: "34%", icon: () => <ChartArea aria-hidden="true" /> },
];

const PAGE_TITLE: Record<DetailPage, string> = {
  profile: "Profile",
  instructions: "Instructions",
  model: "Model",
  permissions: "Permissions",
  advanced: "Advanced",
  memories: "Memories",
  skills: "Skills",
  files: "Files",
  tables: "Tables",
  routines: "Routines",
  usage: "Usage",
};

const PAGE_ITEMS: Partial<Record<DetailPage, { title: string; detail: string }[]>> = {
  memories: [
    { title: "Prefers short weekly summaries", detail: "Saved 2 days ago" },
    { title: "Launch date is 14 November", detail: "Saved last week" },
    { title: "Design reviews are on Thursdays", detail: "Saved last month" },
  ],
  skills: [
    { title: "Release notes", detail: "Marketplace" },
    { title: "Meeting brief", detail: "Marketplace" },
    { title: "Linear triage", detail: "Custom" },
    { title: "Slide deck", detail: "Marketplace" },
    { title: "Web research", detail: "Built in" },
  ],
  files: [
    { title: "notes", detail: "48 files · 12 MB" },
    { title: "plans", detail: "9 files · 3 MB" },
    { title: "exports", detail: "31 files · 105 MB" },
  ],
  tables: [
    { title: "Launch tasks", detail: "24 rows" },
    { title: "Contacts", detail: "112 rows" },
  ],
  routines: [
    { title: "Morning brief", detail: "Weekdays at 08:00" },
    { title: "Weekly report", detail: "Fridays at 16:00" },
  ],
  usage: [
    { title: "Today", detail: "12,400 tokens" },
    { title: "This week", detail: "88,000 tokens" },
    { title: "Plan limit", detail: "34% used" },
  ],
};

const MODEL_NAME = "GPT-5.6 Luna";
const MODELS = [
  { id: "luna", name: "GPT-5.6 Luna", provider: "Codex" },
  { id: "opus", name: "Opus 5.5", provider: "Claude" },
  { id: "sonnet", name: "Sonnet 5.5", provider: "Claude" },
];
const REASONING = ["Low", "Medium", "High"];

/* ---------------------------------------------------------------- shared pieces */

interface PanelFrameProps {
  title: string;
  onBack?: () => void;
  /** Extra header controls, before the close button. */
  actions?: JSX.Element;
  /** The body draws its own padding, for layouts such as the icon rail. */
  flush?: boolean;
  children: JSX.Element;
}

/** The panel shell at the shipped default width, with the shipped header glyphs. */
export function PanelFrame(props: PanelFrameProps): JSX.Element {
  return (
    <aside class="apc-panel" aria-label={props.title}>
      <header class="apc-header">
        <Show when={props.onBack} fallback={<span />}>
          <Button variant="ghost" type="button" class="apc-nav" aria-label="Back" onClick={() => props.onBack?.()}>
            <SettingsBackIcon />
          </Button>
        </Show>
        <h2>{props.title}</h2>
        <div class="apc-header-actions">
          {props.actions}
          <Button variant="ghost" type="button" class="apc-nav" aria-label="Close panel">
            <SettingsForwardIcon />
          </Button>
        </div>
      </header>
      <div class={props.flush ? "apc-body apc-body-flush" : "apc-body"}>{props.children}</div>
    </aside>
  );
}

function NavRow(props: { icon?: JSX.Element; label: string; value?: string; onClick: () => void }): JSX.Element {
  return (
    <Button variant="ghost" type="button" class="apc-row" onClick={() => props.onClick()}>
      <Show when={props.icon}>
        <span class="apc-row-icon">{props.icon}</span>
      </Show>
      <span class="apc-row-label">{props.label}</span>
      <span class="apc-row-value">
        {props.value}
        <ChevronRight aria-hidden="true" />
      </span>
    </Button>
  );
}

function ToggleRow(props: { icon?: JSX.Element; label: string; hint?: string; checked?: boolean }): JSX.Element {
  const [checked, setChecked] = createSignal(props.checked ?? true);
  return (
    <div class="apc-row apc-row-static">
      <Show when={props.icon}>
        <span class="apc-row-icon">{props.icon}</span>
      </Show>
      <span class="apc-row-label">
        {props.label}
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </span>
      <Switch size="sm" aria-label={props.label} checked={checked()} onChange={setChecked} />
    </div>
  );
}

function Group(props: { heading?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="apc-group" aria-label={props.heading}>
      <Show when={props.heading}>
        <h3 class="apc-group-heading">{props.heading}</h3>
      </Show>
      <div class="apc-group-rows">{props.children}</div>
    </section>
  );
}

/** One choice of a small set, drawn as a pressed button. Used for reasoning and access. */
function Choice(props: { label: string; hint?: string; selected: boolean; onSelect: () => void }): JSX.Element {
  return (
    <Button
      variant="ghost"
      type="button"
      class="apc-choice"
      aria-pressed={props.selected ? "true" : "false"}
      onClick={() => props.onSelect()}
    >
      <span class="apc-choice-text">
        <strong>{props.label}</strong>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </span>
      <Show when={props.selected}>
        <Check aria-hidden="true" />
      </Show>
    </Button>
  );
}

function Segmented(props: { label: string; options: string[]; value: string }): JSX.Element {
  const [value, setValue] = createSignal(props.value);
  return (
    <SlidingTabs.Root value={value()} onChange={(next: string) => setValue(next)}>
      <SlidingTabs.List class="apc-segmented" aria-label={props.label}>
        <For each={props.options}>{(option) => <SlidingTabs.Trigger value={option}>{option}</SlidingTabs.Trigger>}</For>
      </SlidingTabs.List>
    </SlidingTabs.Root>
  );
}

/* ---------------------------------------------------------------- section bodies */

function ProfileFields(): JSX.Element {
  return (
    <>
      <SettingsField label="Name">
        <Input value={AGENT.name} />
      </SettingsField>
      <SettingsField label="Title">
        <Input value={AGENT.title} placeholder="What the agent does" />
      </SettingsField>
    </>
  );
}

function InstructionsField(props: { rows?: string }): JSX.Element {
  return (
    <SettingsField label="Instructions">
      <Textarea rows={props.rows ?? "4"} value={AGENT.description} />
    </SettingsField>
  );
}

function ModelBody(): JSX.Element {
  const [model, setModel] = createSignal("luna");
  return (
    <>
      <div class="apc-stack">
        <For each={MODELS}>
          {(option) => (
            <Choice
              label={option.name}
              hint={option.provider}
              selected={model() === option.id}
              onSelect={() => setModel(option.id)}
            />
          )}
        </For>
      </div>
      <p class="apc-label">Reasoning</p>
      <Segmented label="Reasoning" options={REASONING} value="Medium" />
    </>
  );
}

function PermissionsBody(): JSX.Element {
  const [access, setAccess] = createSignal<"workspace" | "full">("full");
  return (
    <>
      <div class="apc-stack">
        <Choice
          label="Workspace only"
          hint="Reads and writes only its own folder."
          selected={access() === "workspace"}
          onSelect={() => setAccess("workspace")}
        />
        <Choice
          label="Full access"
          hint="Can use any file and command on this computer."
          selected={access() === "full"}
          onSelect={() => setAccess("full")}
        />
      </div>
      <Group>
        <ToggleRow icon={<Monitor aria-hidden="true" />} label="Computer use" hint="Sees and uses your screen" />
        <ToggleRow
          icon={<SlidersHorizontal aria-hidden="true" />}
          label="Local scripts"
          hint="Runs scripts on this computer"
          checked={false}
        />
      </Group>
    </>
  );
}

function AdvancedBody(): JSX.Element {
  return (
    <>
      <p class="apc-label">Messages sent while it works</p>
      <Segmented label="Messages sent while it works" options={["Default", "Queue", "Steer"]} value="Default" />
      <p class="apc-label">Working folder</p>
      <div class="apc-path">
        <span class="apc-path-text">{AGENT.workspacePath}</span>
        <IconButton variant="ghost" label="Open folder">
          <FolderOpen aria-hidden="true" />
        </IconButton>
      </div>
      <Group>
        <ToggleRow icon={<Bell aria-hidden="true" />} label="Notifications" />
      </Group>
      <NewChatButton />
    </>
  );
}

function NewChatButton(): JSX.Element {
  return (
    <Button variant="outline" type="button" class="apc-new-chat">
      <RotateCcw aria-hidden="true" />
      Start new chat
    </Button>
  );
}

function ItemList(props: { page: DetailPage }): JSX.Element {
  return (
    <div class="apc-group-rows">
      <For each={PAGE_ITEMS[props.page] ?? []}>
        {(item) => (
          <div class="apc-row apc-row-static">
            <span class="apc-row-label">
              {item.title}
              <small>{item.detail}</small>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function DetailBody(props: { page: DetailPage }): JSX.Element {
  switch (props.page) {
    case "profile":
      return (
        <>
          <div class="apc-hero">
            <AgentAvatar agent={AGENT} class="apc-avatar-xl" motion="always" />
            <Button variant="outline" size="sm" type="button">
              Change picture
            </Button>
          </div>
          <ProfileFields />
        </>
      );
    case "instructions":
      return <InstructionsField rows="14" />;
    case "model":
      return <ModelBody />;
    case "permissions":
      return <PermissionsBody />;
    case "advanced":
      return <AdvancedBody />;
    default:
      return <ItemList page={props.page} />;
  }
}

/** A drilled-in page with a back button, as the shipped Routines and Files pages work. */
function DetailFrame(props: { page: DetailPage; onBack: () => void }): JSX.Element {
  return (
    <PanelFrame title={PAGE_TITLE[props.page]} onBack={props.onBack}>
      <DetailBody page={props.page} />
    </PanelFrame>
  );
}

/** Root view plus one level of drill-in pages. */
function WithPages(props: { start?: DetailPage; root: (open: (page: DetailPage) => void) => JSX.Element }) {
  const [page, setPage] = createSignal<DetailPage | null>(props.start ?? null);
  return (
    <Show when={page()} fallback={props.root(setPage)}>
      {(current) => <DetailFrame page={current()} onBack={() => setPage(null)} />}
    </Show>
  );
}

/* ---------------------------------------------------------------- 1. grouped list */

/**
 * The settings-app pattern: a profile card, then short groups of icon rows. Every row opens one
 * page, so the root shows names and current values only, never a form.
 */
export function GroupedListConcept(props: { start?: DetailPage }): JSX.Element {
  return (
    <WithPages
      start={props.start}
      root={(open) => (
        <PanelFrame title="Agent">
          <Button variant="ghost" type="button" class="apc-profile-card" onClick={() => open("profile")}>
            <AgentAvatar agent={AGENT} class="apc-avatar-lg" />
            <span class="apc-profile-text">
              <strong>{AGENT.name}</strong>
              <small>{AGENT.title}</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button variant="ghost" type="button" class="apc-quote" onClick={() => open("instructions")}>
            <span class="apc-quote-label">Instructions</span>
            <span class="apc-quote-text">{AGENT.description}</span>
          </Button>
          <Group heading="Brain">
            <NavRow
              icon={<Brain aria-hidden="true" />}
              label="Model"
              value={`${MODEL_NAME} · Medium`}
              onClick={() => open("model")}
            />
          </Group>
          <Group heading="Knows">
            <For each={KNOWLEDGE_LINKS}>
              {(link) => (
                <NavRow icon={link.icon()} label={link.label} value={link.value} onClick={() => open(link.page)} />
              )}
            </For>
          </Group>
          <Group heading="Does">
            <For each={ACTIVITY_LINKS}>
              {(link) => (
                <NavRow icon={link.icon()} label={link.label} value={link.value} onClick={() => open(link.page)} />
              )}
            </For>
          </Group>
          <Group heading="Rules">
            <NavRow
              icon={<ShieldCheck aria-hidden="true" />}
              label="Permissions"
              value="Full access"
              onClick={() => open("permissions")}
            />
            <ToggleRow icon={<Bell aria-hidden="true" />} label="Notifications" />
            <NavRow icon={<SlidersHorizontal aria-hidden="true" />} label="Advanced" onClick={() => open("advanced")} />
          </Group>
        </PanelFrame>
      )}
    />
  );
}

/* ---------------------------------------------------------------- 2. tabs */

/**
 * Three tabs split who the agent is, what it knows, and how it runs. Each tab is short enough to
 * need no scrolling at the default panel height.
 */
export function TabsConcept(props: { tab?: "profile" | "knowledge" | "settings" }): JSX.Element {
  const [tab, setTab] = createSignal<string>(props.tab ?? "profile");
  return (
    <WithPages
      root={(open) => (
        <PanelFrame title="Agent">
          <div class="apc-identity">
            <AgentAvatar agent={AGENT} class="apc-avatar-md" />
            <span class="apc-profile-text">
              <strong>{AGENT.name}</strong>
              <small>{AGENT.title}</small>
            </span>
          </div>
          <SlidingTabs.Root value={tab()} onChange={(next: string) => setTab(next)}>
            <SlidingTabs.List class="apc-segmented apc-tabs" aria-label="Agent sections">
              <SlidingTabs.Trigger value="profile">Profile</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="knowledge">Knowledge</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="settings">Settings</SlidingTabs.Trigger>
            </SlidingTabs.List>
            <SlidingTabs.ContentSlot class="apc-tab-slot">
              <SlidingTabs.Content value="profile" class="apc-tab-panel">
                <ProfileFields />
                <InstructionsField rows="6" />
              </SlidingTabs.Content>
              <SlidingTabs.Content value="knowledge" class="apc-tab-panel">
                <Group>
                  <For each={[...KNOWLEDGE_LINKS, ...ACTIVITY_LINKS]}>
                    {(link) => (
                      <NavRow
                        icon={link.icon()}
                        label={link.label}
                        value={link.value}
                        onClick={() => open(link.page)}
                      />
                    )}
                  </For>
                </Group>
              </SlidingTabs.Content>
              <SlidingTabs.Content value="settings" class="apc-tab-panel">
                <Group>
                  <NavRow
                    icon={<Brain aria-hidden="true" />}
                    label="Model"
                    value={MODEL_NAME}
                    onClick={() => open("model")}
                  />
                  <NavRow
                    icon={<ShieldCheck aria-hidden="true" />}
                    label="Permissions"
                    value="Full access"
                    onClick={() => open("permissions")}
                  />
                  <ToggleRow icon={<Bell aria-hidden="true" />} label="Notifications" />
                  <NavRow
                    icon={<SlidersHorizontal aria-hidden="true" />}
                    label="Advanced"
                    onClick={() => open("advanced")}
                  />
                </Group>
                <NewChatButton />
              </SlidingTabs.Content>
            </SlidingTabs.ContentSlot>
          </SlidingTabs.Root>
        </PanelFrame>
      )}
    />
  );
}

/* ---------------------------------------------------------------- 3. overview */

/**
 * A profile page, not a form. The root reads like a contact card: who, which model, what it is
 * told, and six tiles. Everything that is set once lives in the "More" menu.
 */
export function OverviewConcept(): JSX.Element {
  const [muted, setMuted] = createSignal(false);
  return (
    <WithPages
      root={(open) => (
        <PanelFrame
          title=""
          actions={
            <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
              <DropdownMenu.Trigger
                class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button apc-nav`}
                aria-label="More"
              >
                <Ellipsis aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  <DropdownMenu.Item onSelect={() => open("profile")}>
                    <Pencil aria-hidden="true" />
                    Edit profile
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => open("model")}>
                    <Brain aria-hidden="true" />
                    Model and reasoning
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => open("permissions")}>
                    <ShieldCheck aria-hidden="true" />
                    Permissions
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => open("advanced")}>
                    <SlidersHorizontal aria-hidden="true" />
                    Advanced
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item>
                    <RotateCcw aria-hidden="true" />
                    Start new chat
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          }
        >
          <div class="apc-hero">
            <AgentAvatar agent={AGENT} class="apc-avatar-xl" motion="always" />
            <strong class="apc-hero-name">{AGENT.name}</strong>
            <small class="apc-hero-title">{AGENT.title}</small>
            <Button variant="ghost" type="button" class="apc-chip" onClick={() => open("model")}>
              <Brain aria-hidden="true" />
              {MODEL_NAME} · Medium
            </Button>
          </div>
          <div class="apc-quick">
            <Button variant="ghost" type="button" class="apc-quick-action">
              <MessageCircle aria-hidden="true" />
              New chat
            </Button>
            <Button
              variant="ghost"
              type="button"
              class="apc-quick-action"
              aria-pressed={muted() ? "true" : "false"}
              onClick={() => setMuted(!muted())}
            >
              <Bell aria-hidden="true" />
              {muted() ? "Muted" : "Notify"}
            </Button>
            <Button variant="ghost" type="button" class="apc-quick-action" onClick={() => open("profile")}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          </div>
          <Button variant="ghost" type="button" class="apc-quote" onClick={() => open("instructions")}>
            <span class="apc-quote-label">Instructions</span>
            <span class="apc-quote-text">{AGENT.description}</span>
          </Button>
          <div class="apc-tiles">
            <For each={[...KNOWLEDGE_LINKS, ...ACTIVITY_LINKS]}>
              {(link) => (
                <Button variant="ghost" type="button" class="apc-tile" onClick={() => open(link.page)}>
                  <span class="apc-tile-icon">{link.icon()}</span>
                  <strong>{link.value}</strong>
                  <small>{link.label}</small>
                </Button>
              )}
            </For>
          </div>
        </PanelFrame>
      )}
    />
  );
}

/* ---------------------------------------------------------------- 4. collapsible sections */

interface FoldProps {
  title: string;
  summary: string;
  open?: boolean;
  children: JSX.Element;
}

/** A section that shows its state in one line while it is closed. */
function Fold(props: FoldProps): JSX.Element {
  const [open, setOpen] = createSignal(props.open ?? false);
  return (
    <section class="apc-fold" data-open={open() ? "" : undefined}>
      <Button
        variant="ghost"
        type="button"
        class="apc-fold-trigger"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen(!open())}
      >
        <span class="apc-row-label">
          {props.title}
          <small>{props.summary}</small>
        </span>
        <ChevronDown aria-hidden="true" class="apc-fold-chevron" />
      </Button>
      <Show when={open()}>
        <div class="apc-fold-body">{props.children}</div>
      </Show>
    </section>
  );
}

/**
 * Everything on one page, but only the essentials are open: who it is, its model, its
 * instructions. Each closed section still says what it holds.
 */
export function CollapsibleConcept(props: { openAll?: boolean }): JSX.Element {
  return (
    <WithPages
      root={(open) => (
        <PanelFrame title="Agent">
          <div class="apc-identity">
            <AgentAvatar agent={AGENT} class="apc-avatar-md" />
            <span class="apc-profile-text">
              <strong>{AGENT.name}</strong>
              <small>{AGENT.title}</small>
            </span>
            <IconButton variant="ghost" label="Edit profile" onClick={() => open("profile")}>
              <Pencil aria-hidden="true" />
            </IconButton>
          </div>
          <Group>
            <NavRow
              icon={<Brain aria-hidden="true" />}
              label="Model"
              value={`${MODEL_NAME} · Medium`}
              onClick={() => open("model")}
            />
          </Group>
          <InstructionsField />
          <Fold title="Knowledge" summary="3 memories · 5 skills · 2 tables" open={props.openAll}>
            <div class="apc-group-rows">
              <For each={KNOWLEDGE_LINKS}>
                {(link) => <NavRow label={link.label} value={link.value} onClick={() => open(link.page)} />}
              </For>
            </div>
          </Fold>
          <Fold title="Routines" summary="2 on · next at 08:00" open={props.openAll}>
            <ItemList page="routines" />
          </Fold>
          <Fold title="Permissions" summary="Full access · computer use on" open={props.openAll}>
            <PermissionsBody />
          </Fold>
          <Fold title="Advanced" summary="Notifications on · app default" open={props.openAll}>
            <AdvancedBody />
          </Fold>
        </PanelFrame>
      )}
    />
  );
}

/* ---------------------------------------------------------------- 5. icon rail */

const RAIL_SECTIONS = [
  { value: "profile", label: "Profile", icon: () => <UserRound aria-hidden="true" /> },
  { value: "model", label: "Model", icon: () => <Brain aria-hidden="true" /> },
  { value: "knowledge", label: "Knowledge", icon: () => <MemoryStick aria-hidden="true" /> },
  { value: "routines", label: "Routines", icon: () => <Workflow aria-hidden="true" /> },
  { value: "permissions", label: "Permissions", icon: () => <ShieldCheck aria-hidden="true" /> },
  { value: "advanced", label: "Advanced", icon: () => <SlidersHorizontal aria-hidden="true" /> },
] as const;

/**
 * A vertical icon rail inside the panel, as in an editor's side bar. One section at a time, and
 * the rail shows every section without any text.
 */
export function IconRailConcept(props: { section?: (typeof RAIL_SECTIONS)[number]["value"] }): JSX.Element {
  const [section, setSection] = createSignal<string>(props.section ?? "profile");
  const current = () => RAIL_SECTIONS.find((item) => item.value === section()) ?? RAIL_SECTIONS[0];
  return (
    <WithPages
      root={(open) => (
        <PanelFrame title={current().label} flush>
          <Tabs.Root
            class="apc-rail-layout"
            orientation="vertical"
            value={section()}
            onChange={(next: string) => setSection(next)}
          >
            <Tabs.List class="apc-rail" aria-label="Agent sections">
              <AgentAvatar agent={AGENT} class="apc-avatar-sm" />
              <For each={RAIL_SECTIONS}>
                {(item) => (
                  <Tabs.Trigger value={item.value} class="apc-rail-item" aria-label={item.label} title={item.label}>
                    {item.icon()}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
            <div class="apc-rail-content">
              <Tabs.Content value="profile">
                <ProfileFields />
                <InstructionsField rows="8" />
              </Tabs.Content>
              <Tabs.Content value="model">
                <ModelBody />
              </Tabs.Content>
              <Tabs.Content value="knowledge">
                <div class="apc-group-rows">
                  <For each={KNOWLEDGE_LINKS}>
                    {(link) => (
                      <NavRow
                        icon={link.icon()}
                        label={link.label}
                        value={link.value}
                        onClick={() => open(link.page)}
                      />
                    )}
                  </For>
                </div>
              </Tabs.Content>
              <Tabs.Content value="routines">
                <ItemList page="routines" />
                <NavRow label="Usage" value="34%" onClick={() => open("usage")} />
              </Tabs.Content>
              <Tabs.Content value="permissions">
                <PermissionsBody />
              </Tabs.Content>
              <Tabs.Content value="advanced">
                <AdvancedBody />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </PanelFrame>
      )}
    />
  );
}

/* ---------------------------------------------------------------- gallery */

export function ConceptCard(props: { caption: string; note: string; children: JSX.Element }): JSX.Element {
  return (
    <figure class="apc-card">
      <div class="apc-card-stage">{props.children}</div>
      <figcaption>
        <strong>{props.caption}</strong>
        <span>{props.note}</span>
      </figcaption>
    </figure>
  );
}
