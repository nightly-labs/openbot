import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { MemoryEntry } from "@openbot/contracts/ipc";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
import { Button, Input, Plus, Search, Switch, Textarea } from "@openbot/ui";
import {
  SettingsLinkGroup,
  SettingsLinkRow,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "@openbot/ui/components/SettingsPanel";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AgentMemoriesEmpty } from "./AgentMemoriesEmpty";

type Inclusion = "essential" | "searchable";

const LIMIT_TEXT = {
  agent: "memory.limitAgent",
  channel: "memory.limitChannel",
} as const satisfies Record<"agent" | "channel", keyof AppMessages>;

const GROUPS = [
  { inclusion: "essential", title: "memory.group.always" },
  { inclusion: "searchable", title: "memory.group.relevant" },
] as const satisfies readonly { inclusion: Inclusion; title: AppTextKey }[];

export interface AgentMemoriesViewProps {
  ownerNoun: "agent" | "channel";
  ownerLabel: string;
  memories: readonly MemoryEntry[];
  inclusion?: ReadonlyMap<string, Inclusion> | undefined;
  userControlled?: ReadonlySet<string> | undefined;
  loading: boolean;
  error: string | null;
  reachedLimit: number | null;
  savingId: string | null;
  onBack: () => void;
  onClose: () => void;
  onCreate: (text: string) => Promise<boolean>;
  onUpdate: (memory: MemoryEntry, text: string) => Promise<boolean>;
  onDelete: (memory: MemoryEntry) => void;
  onSetEveryChat: (memory: MemoryEntry, everyChat: boolean) => void;
  onLetAgentDecide: (memory: MemoryEntry) => void;
  onClearAll: () => void;
}

function splitMemory(text: string): { title: string; body: string } {
  const label = /^([^:.!?\n]{2,40}?):\s+(.+)$/s.exec(text);
  if (label?.[1] && label[2]) {
    return { title: label[1], body: label[2] };
  }
  const sentence = /^([^\n]{8,100}?[.!?])\s+(.+)$/s.exec(text);
  if (sentence?.[1] && sentence[2]) return { title: sentence[1], body: sentence[2] };
  return { title: text, body: "" };
}

export function AgentMemoriesView(props: AgentMemoriesViewProps) {
  const { t, format } = useText();
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const current = createMemo(() => props.memories.find((memory) => memory.id === openId()));
  const rows = new Map<string, HTMLButtonElement>();
  let newRow: HTMLButtonElement | undefined;
  const [query, setQuery] = createSignal("");
  const searching = () => query().trim() !== "";

  const matches = createMemo(() => {
    const words = query().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return props.memories;
    return props.memories.filter((memory) => {
      const text = `${memory.text} ${memory.site ?? ""}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  const groups = createMemo(() => {
    const inclusion = props.inclusion;
    if (!inclusion) return [{ title: null, memories: matches() }];
    return GROUPS.map((group) => ({
      title: t(group.title),
      memories: matches().filter((memory) => (inclusion.get(memory.id) ?? "searchable") === group.inclusion),
    })).filter((group) => group.memories.length > 0);
  });

  const title = () => {
    const memory = current();
    if (!memory) return t("memory.title");
    const { title, body } = splitMemory(memory.text);
    return body ? title : t("memory.single");
  };
  const backLabel = () => (current() ? t("memory.backToList") : t("memory.backToSettings"));

  function openMemory(memory: MemoryEntry): void {
    setAdding(false);
    setEditing(false);
    setOpenId(memory.id);
  }

  function back(): void {
    const id = openId();
    if (current() === undefined || id === null) {
      setOpenId(null);
      props.onBack();
      return;
    }
    setOpenId(null);
    setEditing(false);
    queueMicrotask(() => rows.get(id)?.focus());
  }

  function startAdding(): void {
    setQuery("");
    setOpenId(null);
    setAdding(true);
  }

  function stopAdding(): void {
    setAdding(false);
    queueMicrotask(() => newRow?.focus());
  }

  function deleteMemory(memory: MemoryEntry): void {
    setOpenId(null);
    setEditing(false);
    props.onDelete(memory);
    queueMicrotask(() => newRow?.focus());
  }

  return (
    <div class="agent-memories-view">
      <SettingsPanelHeader
        title={title()}
        onBack={back}
        backLabel={backLabel()}
        onClose={props.onClose}
        closeLabel={t("memory.closePane")}
      />
      <SettingsPanelContent>
        <div class="agent-memories-page">
          <Show when={props.reachedLimit}>
            {(limit) => (
              <p class="agent-memory-limit" role="status">
                {t(LIMIT_TEXT[props.ownerNoun], { limit: limit() })}
              </p>
            )}
          </Show>
          <Show when={props.error}>
            {(message) => (
              <p class="agent-memory-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show
            when={current()}
            fallback={
              <Show when={!props.loading} fallback={<p class="agent-memory-state">{t("memory.loading")}</p>}>
                <Show
                  when={props.memories.length > 0 || adding()}
                  fallback={
                    <Show when={!props.error}>
                      <div class="agent-memories-view-empty">
                        <AgentMemoriesEmpty
                          ownerNoun={props.ownerNoun}
                          ownerLabel={props.ownerLabel}
                          addDisabled={props.reachedLimit !== null}
                          onAdd={startAdding}
                        />
                      </div>
                    </Show>
                  }
                >
                  <Show when={props.memories.length > 0}>
                    <div class="agent-memories-search">
                      <Search class="agent-memories-search-icon" aria-hidden="true" />
                      <Input
                        type="search"
                        size="sm"
                        class="agent-memories-search-input"
                        placeholder={t("memory.search")}
                        aria-label={t("memory.search")}
                        value={query()}
                        onValueChange={setQuery}
                        onKeyDown={(event: KeyboardEvent) => {
                          if (event.key !== "Escape" || !query()) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setQuery("");
                        }}
                      />
                    </div>
                  </Show>
                  <Show
                    when={adding()}
                    fallback={
                      <Show when={props.reachedLimit === null}>
                        <SettingsLinkGroup inset>
                          <SettingsLinkRow
                            ref={(element) => {
                              newRow = element;
                            }}
                            icon={<Plus aria-hidden="true" />}
                            label={t("memory.new")}
                            onClick={startAdding}
                          />
                        </SettingsLinkGroup>
                      </Show>
                    }
                  >
                    <MemoryEditor
                      initial=""
                      label={t("memory.new")}
                      placeholder={t("memory.newPlaceholder")}
                      saveLabel={t("memory.save")}
                      saving={props.savingId === "new"}
                      onSave={async (text) => {
                        if (await props.onCreate(text)) stopAdding();
                      }}
                      onCancel={stopAdding}
                    />
                  </Show>
                  <For each={groups()}>
                    {(group) => (
                      <SettingsLinkGroup inset title={group.title ?? undefined}>
                        <For each={group.memories} keyed={(memory) => memory.id}>
                          {(memory) => (
                            <SettingsLinkRow
                              ref={(element) => {
                                rows.set(untrack(memory).id, element);
                              }}
                              label={splitMemory(memory().text).title}
                              value={memory().site}
                              onClick={() => openMemory(memory())}
                            />
                          )}
                        </For>
                      </SettingsLinkGroup>
                    )}
                  </For>
                  <Show when={searching() && matches().length === 0}>
                    <p class="agent-memory-state" role="status">
                      {t("memory.noMatches")}
                    </p>
                  </Show>
                  <Show when={props.memories.length > 0 && !searching()}>
                    <div class="agent-memories-clear">
                      <Button
                        size="sm"
                        variant="destructive-ghost"
                        disabled={props.savingId !== null}
                        onClick={props.onClearAll}
                      >
                        {t("memory.clearAll")}
                      </Button>
                    </div>
                  </Show>
                </Show>
              </Show>
            }
          >
            {(memory) => (
              <>
                <Show
                  when={editing()}
                  fallback={
                    <div class="agent-memories-reading">
                      <p class="agent-memories-text">{memory().text}</p>
                      <p class="agent-memories-meta">
                        {memory().origin === "automatic" ? t("memory.learned") : t("memory.manual")}
                        <Show when={memory().site}>{(site) => ` · ${site()}`}</Show>
                        {" · "}
                        {memoryDate(memory().updatedAt)}
                      </p>
                    </div>
                  }
                >
                  <MemoryEditor
                    initial={memory().text}
                    label={t("memory.edit")}
                    saveLabel={t("common.save")}
                    saving={props.savingId === memory().id}
                    onSave={async (text) => {
                      if (text === memory().text || (await props.onUpdate(memory(), text))) setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                  />
                </Show>
                <Show when={props.inclusion?.get(memory().id)}>
                  {(inclusion) => (
                    <SettingsLinkGroup inset class="agent-settings-runtime-rows">
                      <div class="agent-settings-switch-row">
                        <span class="settings-link-label">{t("memory.everyChat")}</span>
                        <Switch
                          size="sm"
                          aria-label={t("memory.everyChat")}
                          checked={inclusion() === "essential"}
                          disabled={props.savingId !== null}
                          onChange={(checked) => props.onSetEveryChat(memory(), checked)}
                        />
                      </div>
                    </SettingsLinkGroup>
                  )}
                </Show>
                <Show when={!editing()}>
                  <div class="agent-memories-actions">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      {t("memory.editAction")}
                    </Button>
                    <Show when={props.userControlled?.has(memory().id)}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={props.savingId !== null}
                        onClick={() => props.onLetAgentDecide(memory())}
                      >
                        {t("memory.inclusion.automatic")}
                      </Button>
                    </Show>
                    <Button size="sm" variant="ghost" onClick={() => deleteMemory(memory())}>
                      {t("memory.deleteAction")}
                    </Button>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      </SettingsPanelContent>
    </div>
  );

  function memoryDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("memory.unknownDate");
    return format.date(date, { dateStyle: "medium" });
  }
}

function MemoryEditor(props: {
  initial: string;
  label: string;
  placeholder?: string;
  saveLabel: string;
  saving: boolean;
  onSave: (text: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useText();
  const [text, setText] = createSignal(props.initial);
  const save = () => {
    const value = text().trim();
    if (value && !props.saving) void props.onSave(value);
  };
  return (
    <div class="agent-memories-editor">
      <Textarea
        ref={(element) => {
          queueMicrotask(() => {
            element.focus();
            element.setSelectionRange(element.value.length, element.value.length);
          });
        }}
        class="agent-memories-field"
        rows="2"
        maxlength={INPUT_LIMITS.agentMemoryText}
        value={text()}
        placeholder={props.placeholder}
        aria-label={props.label}
        onValueChange={setText}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div class="agent-memories-editor-actions">
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!text().trim()} loading={props.saving} onClick={save}>
          {props.saveLabel}
        </Button>
      </div>
    </div>
  );
}
