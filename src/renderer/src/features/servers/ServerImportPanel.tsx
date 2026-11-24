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

const SOURCE_NAMES = {
  "grok-bot": "Grok Bot",
  "hermes-agent": "Hermes Agent",
} as const satisfies Record<AgentImportSkillSource, string>;

export interface ServerImportDetail {
  title: string;
  back: () => void;
}

const SETUP_STORAGE_KEYS = {
  "grok-bot": "openbot.agent-import.setup",
  "hermes-agent": "openbot.agent-import.hermes-setup",
} as const satisfies Record<AgentImportSkillSource, string>;

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
  openExportAgent(): void;
  hermes?: Pick<OpenBotDesktopApi["agentImport"], Exclude<HermesCall, "chooseHermes">> &
    Partial<Pick<OpenBotDesktopApi["agentImport"], "chooseHermes">>;
};

export type HermesFolderPlace = "computer" | "server";

export interface ServerImportOptions {
  onOpenAgent: (agentId: string) => void;
  onClose: () => void;
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

export function ServerImportPanel(
  props: ServerImportOptions & {
    serverId: string;
    hermes?: HermesFolderPlace | undefined;
    onServer?: boolean | undefined;
    onOpenTransfer?: (() => void) | undefined;
    onDetailChange?: ((detail: ServerImportDetail | null) => void) | undefined;
  },
) {
  const { t, errorMessage } = useText();
  const calls = props.calls ?? desktopCalls();
  const serverId = props.serverId;
  const hermesCalls = props.hermes ? calls.hermes : undefined;
  const chooseHermes = props.hermes === "computer" ? hermesCalls?.chooseHermes : undefined;

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
    } catch {}
  };

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
      const preview = (await calls.choose(serverId)) ?? open;
      show({ phase: preview ? "review" : "idle", error: null, preview, result: null });
    } catch (error) {
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
      show({ phase: "idle", error: errorMessage(error, t("server.import.applyFailed")), preview: null, result: null });
    }
  };

  const [folder, setFolder] = createSignal(false);
  const [hermes, setHermes] = createStore<HermesState>({ phase: "reading", error: null, preview: null, result: null });
  const showHermes = (next: HermesState) =>
    setHermes((draft) => {
      Object.assign(draft, next);
    });
  const releaseHermes = () => {
    const token = hermes.preview?.token;
    if (token) void hermesCalls?.discardHermes(token, serverId).catch(() => undefined);
  };
  onSettled(() => releaseHermes);

  const readHermes = async (read: () => Promise<HermesImportPreview | null>, keep: boolean) => {
    const open = hermes.preview;
    setHermes((draft) => {
      if (!open) draft.phase = "reading";
      draft.error = null;
    });
    try {
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
      const result = await hermesCalls.applyHermes({ token: preview.token, profiles: selection }, serverId);
      showHermes({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      showHermes({
        phase: "review",
        error: errorMessage(error, t("server.import.applyFailed")),
        preview,
        result: null,
      });
    }
  };

  const chooseFolder = () => {
    const choose = chooseHermes;
    return choose ? () => void readHermes(() => choose(), true) : undefined;
  };
  const openFolder = () => {
    if (!hermesCalls) return;
    setFolder(true);
    void readHermes(() => hermesCalls.readHermes(serverId), false);
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
          hermesFolder={props.hermes}
          onServer={props.onServer}
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
          server={props.hermes === "server"}
          onChooseFolder={chooseFolder()}
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
              folderOnServer={props.hermes === "server"}
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
