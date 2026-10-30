import type {
  AgentImportPreview,
  AgentImportResult,
  AgentImportSkillSource,
  HermesImportPreview,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { AgentImportSources } from "@openbot/ui/features/import/AgentImportSources";
import {
  type AgentImportPhase,
  type AgentImportSetup,
  AgentImportView,
} from "@openbot/ui/features/import/AgentImportView";
import {
  type HermesImportPhase,
  type HermesImportSelection,
  HermesImportView,
} from "@openbot/ui/features/import/HermesImportView";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, Match, onSettled, Switch } from "solid-js";
import { actionToast } from "../../action-toast";

/** Product names, the same in each language. */
const SOURCE_NAMES = {
  "grok-bot": "Grok Bot",
  "hermes-agent": "Hermes Agent",
} as const satisfies Record<AgentImportSkillSource, string>;

/** The source on screen, so the dialog header reads `Import › Hermes Agent`. */
export interface ServerImportDetail {
  title: string;
  back: () => void;
}

/** The way into each app this viewer chose last, so a user who set up the skill starts there. */
const SETUP_STORAGE_KEYS = {
  "grok-bot": "openbot.agent-import.setup",
  "hermes-agent": "openbot.agent-import.hermes-setup",
} as const satisfies Record<AgentImportSkillSource, string>;

/** The setups each app offers. Reading the Hermes folder needs this computer. */
function setupsFor(source: AgentImportSkillSource, folder: boolean): readonly AgentImportSetup[] {
  if (source === "grok-bot") return ["agent", "skill"];
  return folder ? ["folder", "command", "skill"] : ["command", "skill"];
}

function readSetup(source: AgentImportSkillSource, folder: boolean): AgentImportSetup {
  const setups = setupsFor(source, folder);
  const fallback = setups[0] ?? "skill";
  try {
    const stored = window.localStorage.getItem(SETUP_STORAGE_KEYS[source]);
    return setups.find((setup) => setup === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

type HermesCall = "readHermes" | "chooseHermes" | "applyHermes" | "discardHermes";

export type AgentImportCalls = Omit<OpenBotDesktopApi["agentImport"], HermesCall> & {
  /** Opens the ready export agent's Grok Bot page. */
  openExportAgent(): void;
  /** The Hermes folder calls, on desktop only: main reads the Hermes folder of this computer. */
  hermes?: Pick<OpenBotDesktopApi["agentImport"], HermesCall>;
};

export interface ServerImportOptions {
  onOpenAgent: (agentId: string) => void;
  /** Closes the settings the panel is in. */
  onClose: () => void;
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: AgentImportCalls;
}

const desktopCalls = (): AgentImportCalls => ({
  ...window.openbot.agentImport,
  openExportAgent: () => void window.openbot.openExternal("grok-bot-export"),
  hermes: window.openbot.agentImport,
});

interface ImportState {
  phase: AgentImportPhase;
  error: string | null;
  preview: AgentImportPreview | null;
  result: AgentImportResult | null;
}

interface HermesState {
  phase: HermesImportPhase;
  error: string | null;
  preview: HermesImportPreview | null;
  result: AgentImportResult | null;
}

/**
 * Server settings > Import. The user chooses where the agents are now: Hermes Agent, Grok Bot, or
 * another OpenBot computer. An export file from Grok Bot or Hermes takes the same steps: main opens
 * the file dialog and the host keeps the export under a token, so the panel holds the preview and
 * never a path. Hermes on this computer can also be read from its folder, item by item. A preview
 * left open when the panel closes is released.
 */
export function ServerImportPanel(
  props: ServerImportOptions & {
    serverId: string;
    /** This computer's server: the Hermes folder here can be read with no export. */
    hermes?: boolean;
    /** Opens the Transfer section, when the settings have one. */
    onOpenTransfer?: (() => void) | undefined;
    onDetailChange?: ((detail: ServerImportDetail | null) => void) | undefined;
  },
) {
  const { t, errorMessage } = useText();
  const calls = props.calls ?? desktopCalls();
  // The server the preview's token belongs to, fixed for the life of the panel.
  const serverId = props.serverId;
  const hermesCalls = props.hermes ? calls.hermes : undefined;

  const [source, setSource] = createSignal<AgentImportSkillSource | null>(null);
  const [state, setState] = createStore<ImportState>({ phase: "idle", error: null, preview: null, result: null });
  const show = (next: ImportState) =>
    setState((draft) => {
      Object.assign(draft, next);
    });
  const release = () => {
    const token = state.preview?.token;
    if (token) void calls.discard(token, serverId).catch(() => undefined);
  };
  onSettled(() => release);
  const reset = () => {
    release();
    show({ phase: "idle", error: null, preview: null, result: null });
  };

  const [setups, setSetups] = createStore<Record<AgentImportSkillSource, AgentImportSetup>>({
    "grok-bot": readSetup("grok-bot", false),
    "hermes-agent": readSetup("hermes-agent", Boolean(hermesCalls)),
  });
  const changeSetup = (current: AgentImportSkillSource, next: AgentImportSetup) => {
    setSetups((draft) => {
      draft[current] = next;
    });
    try {
      window.localStorage.setItem(SETUP_STORAGE_KEYS[current], next);
    } catch {
      // The choice is a convenience. Without storage, the panel opens on the default again.
    }
  };

  // Read once: the skills ship with the app and do not change while it runs.
  const [exportSkills, setExportSkills] = createStore<Record<AgentImportSkillSource, string | null>>({
    "grok-bot": null,
    "hermes-agent": null,
  });
  onSettled(() => {
    for (const skill of ["grok-bot", "hermes-agent"] as const)
      void calls
        .readSkill(skill)
        .then((text) =>
          setExportSkills((draft) => {
            draft[skill] = text;
          }),
        )
        .catch(() => undefined);
  });

  const saveSkill = async (skill: AgentImportSkillSource) => {
    try {
      await calls.saveSkill(skill);
    } catch (error) {
      actionToast.error(t("server.import.skillSaveFailed"), {
        ...{
          description: errorMessage(error, t("server.import.tryAgain")),
        },
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
    }
  };

  const choose = async () => {
    const open = state.preview;
    setState((draft) => {
      draft.phase = "reading";
      draft.error = null;
    });
    try {
      // Null when the user cancels the dialog. Main keeps the export that was open until then.
      const preview = (await calls.choose(serverId)) ?? open;
      show({ phase: preview ? "review" : "idle", error: null, preview, result: null });
    } catch (error) {
      // A check before the host read the new export can fail with the old one still open there.
      // A released token makes the discard do nothing.
      if (open) void calls.discard(open.token, serverId).catch(() => undefined);
      show({ phase: "idle", error: errorMessage(error, t("server.import.readFailed")), preview: null, result: null });
    }
  };

  const apply = async (keys: string[], channelKeys: string[]) => {
    const preview = state.preview;
    if (!preview) return;
    setState((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await calls.apply({ token: preview.token, keys, channelKeys }, serverId);
      show({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      // The token is spent either way, so the user chooses the export again.
      show({ phase: "idle", error: errorMessage(error, t("server.import.applyFailed")), preview: null, result: null });
    }
  };

  // Hermes read from its folder on this computer, with the item review instead of an export.
  const [folder, setFolder] = createSignal(false);
  const [hermes, setHermes] = createStore<HermesState>({ phase: "reading", error: null, preview: null, result: null });
  const showHermes = (next: HermesState) =>
    setHermes((draft) => {
      Object.assign(draft, next);
    });
  const releaseHermes = () => {
    const token = hermes.preview?.token;
    if (token) void hermesCalls?.discardHermes(token).catch(() => undefined);
  };
  onSettled(() => releaseHermes);

  const readHermes = async (read: () => Promise<HermesImportPreview | null>, keep: boolean) => {
    const open = hermes.preview;
    setHermes((draft) => {
      if (!open) draft.phase = "reading";
      draft.error = null;
    });
    try {
      // Null: the folder has no profiles, or the user closed the folder dialog with profiles open.
      const preview = (await read()) ?? (keep ? open : null);
      showHermes({ phase: preview ? "review" : "missing", error: null, preview, result: null });
    } catch (error) {
      showHermes({
        phase: "missing",
        error: errorMessage(error, t("server.import.readFailed")),
        preview: null,
        result: null,
      });
    }
  };

  const [updated, setUpdated] = createSignal<ReadonlySet<string>>(new Set());
  const applyHermes = async (selection: HermesImportSelection[]) => {
    const preview = hermes.preview;
    if (!preview || !hermesCalls) return;
    const keys = new Set(selection.map((entry) => entry.key));
    setUpdated(
      new Set(
        preview.profiles.flatMap((profile) => (keys.has(profile.key) && profile.agent ? [profile.agent.id] : [])),
      ),
    );
    setHermes((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await hermesCalls.applyHermes({ token: preview.token, profiles: selection });
      showHermes({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      // Main keeps the profiles open when a check fails before anything changes, so the same
      // folder stays on screen with the reason on top.
      showHermes({
        phase: "review",
        error: errorMessage(error, t("server.import.applyFailed")),
        preview,
        result: null,
      });
    }
  };

  const openFolder = () => {
    if (!hermesCalls) return;
    setFolder(true);
    void readHermes(() => hermesCalls.readHermes(), false);
  };
  const closeFolder = () => {
    releaseHermes();
    showHermes({ phase: "reading", error: null, preview: null, result: null });
    setFolder(false);
  };
  const backToSources = () => {
    closeFolder();
    reset();
    setSource(null);
  };
  // The dialog outlives this panel, so the cleanup clears a header that would name a source that is gone.
  createEffect(
    () => source(),
    (current) => {
      if (current === null) return;
      props.onDetailChange?.({ title: SOURCE_NAMES[current], back: backToSources });
      return () => props.onDetailChange?.(null);
    },
  );

  return (
    <Switch>
      <Match when={source() === null}>
        <AgentImportSources
          transfer={Boolean(props.onOpenTransfer)}
          onHermes={() => setSource("hermes-agent")}
          onGrok={() => setSource("grok-bot")}
          onTransfer={() => props.onOpenTransfer?.()}
        />
      </Match>
      <Match when={source() === "hermes-agent" && folder()}>
        <HermesImportView
          phase={hermes.phase}
          preview={hermes.preview}
          result={hermes.result}
          updated={updated()}
          error={hermes.error}
          onBack={closeFolder}
          onChooseFolder={() => {
            if (hermesCalls) void readHermes(() => hermesCalls.chooseHermes(), true);
          }}
          onImport={(selection) => void applyHermes(selection)}
          onDone={() => {
            backToSources();
            props.onClose();
          }}
          onOpenAgent={props.onOpenAgent}
        />
      </Match>
      <Match when={source()}>
        {(current) => (
          <>
            {/* The header's `Import` goes back to the sources; a review also has Cancel. */}
            <AgentImportView
              source={current()}
              phase={state.phase}
              error={state.error}
              preview={state.preview}
              result={state.result}
              setup={setups[current()]}
              exportSkill={exportSkills[current()]}
              onSetupChange={(next) => changeSetup(current(), next)}
              onOpenExportAgent={() => calls.openExportAgent()}
              onSaveExportSkill={() => void saveSkill(current())}
              onReadFolder={current() === "hermes-agent" && hermesCalls ? openFolder : undefined}
              onChoose={() => void choose()}
              onImport={(keys, channelKeys) => void apply(keys, channelKeys)}
              onCancel={reset}
              onDone={() => {
                backToSources();
                props.onClose();
              }}
              onOpenAgent={props.onOpenAgent}
            />
          </>
        )}
      </Match>
    </Switch>
  );
}
