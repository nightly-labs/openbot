import type { Watcher, WatcherMatch } from "@openbot/contracts/ipc";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { SettingsBackIcon, SettingsForwardIcon } from "../../components/SettingsPanel";
import { Button, CirclePause, Clock3, Switch } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { formatChatTimestamp } from "./chat-timestamp";
import { type WatchersPort, watcherSourceSummary } from "./watchers-port";

interface AgentWatchersSettingsProps {
  /** Names the owner and owns every call. */
  port: WatchersPort;
  onCountChange: (count: number) => void;
  onBack?: () => void;
  onClose?: () => void;
}

export function AgentWatchersSettings(props: AgentWatchersSettingsProps) {
  const [watchers, setWatchers] = createSignal<Watcher[]>([]);
  const [selected, setSelected] = createSignal<Watcher | null>(null);
  const [matches, setMatches] = createSignal<WatcherMatch[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [working, setWorking] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const scrollFades = createScrollFades();

  onCleanup(scrollFades.stop);

  async function loadWatchers(): Promise<void> {
    try {
      const next = await props.port.list();
      setWatchers(next);
      props.onCountChange(next.length);
      const current = selected();
      if (current && !next.some((watcher) => watcher.id === current.id)) setSelected(null);
    } catch (caught) {
      setError(errorMessage(caught, "Could not load watchers."));
    } finally {
      setLoading(false);
    }
  }

  async function loadMatches(watcherId: string): Promise<void> {
    try {
      setMatches(await props.port.listMatches(watcherId, 10));
    } catch (caught) {
      setError(errorMessage(caught, "Could not load match history."));
    }
  }

  createEffect(
    () => props.port,
    (port) =>
      port.subscribe(() => {
        void loadWatchers();
        const watcherId = selected()?.id;
        if (watcherId) void loadMatches(watcherId);
      }),
  );

  createEffect(
    () => props.port.ownerId,
    () => {
      setSelected(null);
      setMatches([]);
      setLoading(true);
      void loadWatchers();
    },
  );

  createEffect(
    () => [selected(), watchers().length, matches().length, loading(), confirmDelete(), error()] as const,
    () => {
      scrollFades.remeasure();
    },
  );

  function openWatcher(watcher: Watcher): void {
    setConfirmDelete(false);
    setError(null);
    setSelected(watcher);
    void loadMatches(watcher.id);
  }

  function closeDetail(): void {
    setSelected(null);
    setMatches([]);
    setError(null);
    setConfirmDelete(false);
  }

  async function toggleActive(): Promise<void> {
    const current = selected();
    if (!current || working()) return;
    setWorking(true);
    setError(null);
    try {
      const updated = await props.port.setActive(current.id, !current.active);
      setSelected(updated);
      setWatchers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(errorMessage(caught, "Could not change this watcher."));
    } finally {
      setWorking(false);
    }
  }

  async function testNow(): Promise<void> {
    const current = selected();
    if (!current || testing()) return;
    setTesting(true);
    setError(null);
    try {
      setMatches(await props.port.test(current.id));
    } catch (caught) {
      setError(errorMessage(caught, "Could not start the test check."));
    } finally {
      setTesting(false);
    }
  }

  async function deleteWatcher(): Promise<void> {
    const current = selected();
    if (!current) {
      closeDetail();
      return;
    }
    try {
      await props.port.remove(current.id);
      setWatchers((items) => {
        const next = items.filter((watcher) => watcher.id !== current.id);
        props.onCountChange(next.length);
        return next;
      });
      closeDetail();
    } catch (caught) {
      setError(errorMessage(caught, "Could not delete this watcher."));
    }
  }

  return (
    <div class="agent-routines-settings">
      <header class="settings-panel-header agent-routines-header">
        <Button
          variant="ghost"
          type="button"
          class="settings-panel-nav-button"
          aria-label={selected() ? "Back to Watchers" : "Back to settings"}
          onClick={() => (selected() ? closeDetail() : props.onBack?.())}
        >
          <SettingsBackIcon />
        </Button>
        <div class="agent-routines-heading">
          <h2>{selected() ? "Watcher" : "Watchers"}</h2>
        </div>
        <Show when={props.onClose}>
          <Button
            variant="ghost"
            type="button"
            class="settings-panel-nav-button"
            aria-label="Close details"
            onClick={() => props.onClose?.()}
          >
            <SettingsForwardIcon />
          </Button>
        </Show>
      </header>
      <div ref={scrollFades.bind} class={["agent-routines-body", scrollFades.classes()]} onScroll={scrollFades.measure}>
        <Show
          when={selected()}
          fallback={
            <div class="agent-routines-list-view">
              <Show when={!loading()} fallback={<p class="agent-routines-empty">Loading watchers…</p>}>
                <Show when={watchers().length > 0} fallback={<p class="agent-routines-empty">No watchers yet.</p>}>
                  <div class="agent-routines-list">
                    <For each={watchers()}>
                      {(watcher) => (
                        <Button
                          variant="ghost"
                          type="button"
                          class="agent-routine-row"
                          onClick={() => openWatcher(watcher)}
                        >
                          <span
                            class={
                              watcher.active ? "agent-routine-status-icon-active" : "agent-routine-status-icon-paused"
                            }
                          >
                            <Show when={watcher.active} fallback={<CirclePause aria-hidden="true" />}>
                              <Clock3 aria-hidden="true" />
                            </Show>
                          </span>
                          <span>
                            <strong>{watcher.name}</strong>
                            <small>
                              {watcher.active
                                ? `${watcher.intervalMinutes} min · ${watcherSourceSummary(watcher.source)}`
                                : "Paused"}
                            </small>
                          </span>
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          }
        >
          {(current) => (
            <div class="agent-routine-editor">
              <div class="agent-routine-editor-actions">
                <div class="agent-routine-active-toggle">
                  <Switch
                    id="watcher-active"
                    aria-label="Watcher active"
                    checked={current().active}
                    disabled={working()}
                    onChange={() => void toggleActive()}
                  />
                  <label for="watcher-active">{current().active ? "Active" : "Paused"}</label>
                </div>
                <div class="agent-routine-action-buttons">
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <>
                        <Button variant="destructive" type="button" size="sm" onClick={() => void deleteWatcher()}>
                          Delete now
                        </Button>
                        <Button variant="secondary" type="button" size="sm" onClick={() => setConfirmDelete(false)}>
                          Cancel
                        </Button>
                      </>
                    }
                  >
                    <Button variant="destructive" type="button" size="sm" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      class="agent-routine-test"
                      disabled={testing()}
                      loading={testing()}
                      loadingLabel="Starting…"
                      onClick={() => void testNow()}
                    >
                      Test now
                    </Button>
                  </Show>
                </div>
              </div>

              <div class="settings-field">
                <span>Name</span>
                <strong>{current().name}</strong>
              </div>
              <div class="settings-field">
                <span>Source</span>
                <span>{watcherSourceSummary(current().source)}</span>
              </div>
              <div class="settings-field">
                <span>Interval</span>
                <span>Every {current().intervalMinutes} minutes</span>
              </div>
              <div class="settings-field">
                <span>Health</span>
                <span>
                  {current().health === "ok" ? "Healthy" : current().health === "weak" ? "Weak" : "Quarantined"}
                </span>
              </div>

              <section class="agent-routine-history" aria-labelledby="watcher-history-heading">
                <h3 id="watcher-history-heading">Match history</h3>
                <Show when={matches().length > 0} fallback={<p class="agent-routines-empty">No matches yet.</p>}>
                  <div class="agent-routine-run-list">
                    <For each={matches().slice(0, 10)}>
                      {(match) => (
                        <div class="agent-routine-run-row">
                          <span>{match.summary}</span>
                          <span>{formatChatTimestamp(new Date(match.createdAt))}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>
          )}
        </Show>
        <Show when={error()}>
          {(message) => (
            <p class="agent-settings-save-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
    </div>
  );
}
