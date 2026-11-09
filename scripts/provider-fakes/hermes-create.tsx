import type { AgentStatus, ClientAgentModelOption, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { ProviderModelPicker } from "../../packages/ui/src/components/ProviderModelPicker";
import { WorkspaceAgentSetup } from "../../src/renderer/src/features/agents/WorkspaceAgentSetup";
import { setCreateContext } from "./hermes-create-contexts";
import type { HermesCreateCase, HermesCreateReport, HermesCreateResult } from "./hermes-create-report";

declare global {
  interface Window {
    runHermesCreate: (cases: HermesCreateCase[]) => Promise<HermesCreateReport>;
    hermesCreateProgress: (stage: string) => void;
  }
}

class BehaviorFailure extends Error {}

function check(value: boolean, message: string): asserts value {
  if (!value) throw new BehaviorFailure(message);
}

function models(provider: "hermes" | "codex", profile: string): ClientAgentModelOption[] {
  return ["alpha", "beta"].map((suffix) => ({
    provider,
    id: `${provider === "hermes" ? "nous" : "gpt"}:${profile}-${suffix}`,
    name: `${profile} ${suffix}`,
    description: "Synthetic isolated create catalog.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium", "high"],
  }));
}

const inherited = models("hermes", "Inherited");
const work = models("hermes", "Work");
const canonical = models("hermes", "Canonical");
const codex = models("codex", "Codex");

function sharedCase(name: HermesCreateCase): boolean {
  return (
    name === "download-missing" ||
    name === "download-retry" ||
    name === "download-cancel" ||
    name === "runtime-ready-error" ||
    name === "inherited-runtime-connect" ||
    name === "blocked-connect"
  );
}

async function openModels(provider: "Hermes" | "ChatGPT") {
  const trigger = await screen.findByRole("button", { name: /Agent model/u });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("tab", { name: new RegExp(`^${provider}:`, "u") }));
}

async function chooseEffort(provider: "Hermes" | "ChatGPT", effort: "High" | "Medium") {
  await openModels(provider);
  fireEvent.keyDown(await screen.findByLabelText("Agent reasoning effort", { exact: true }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: effort }));
}

async function finishPromiseEvents() {
  await new Promise<void>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data !== "hermes-create-fixture-flush") return;
      window.removeEventListener("message", listener);
      resolve();
    };
    window.addEventListener("message", listener);
    window.postMessage("hermes-create-fixture-flush", "*");
  });
  flush();
}

async function submit() {
  const trigger = await screen.findByRole("button", { name: /Agent model/u });
  if (trigger.getAttribute("aria-expanded") === "true") fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Create agent" }));
  await finishPromiseEvents();
}

function createFixture(name: HermesCreateCase, result: HermesCreateResult) {
  const actionCase =
    name === "download-missing" ||
    name === "download-retry" ||
    name === "download-cancel" ||
    name === "runtime-ready-error" ||
    name === "inherited-runtime-connect" ||
    name === "codex-connect" ||
    name === "blocked-joined" ||
    name === "blocked-connect";
  const dormant = name === "dormant-work" || name === "dormant-default" || name === "other-provider";
  const inheritedCase =
    name === "inherited-readiness" || name === "inherited-available" || name === "inherited-runtime-connect";
  const profile = inheritedCase ? undefined : name === "dormant-default" ? "default" : "work";
  let mounting = true;
  let repeatedMountWrites = 0;
  const [draft, setDraft] = createSignal<FirstAgentDraft>(
    {
      name: "Create fixture",
      purpose: "Check the local create form.",
      avatarSeed: "fixture",
      avatarHue: null,
      avatarColor: null,
      suggestionId: null,
      provider: dormant || (actionCase && name !== "blocked-joined") ? "codex" : "hermes",
      model:
        dormant || (actionCase && name !== "blocked-joined")
          ? "gpt:Codex-alpha"
          : inheritedCase
            ? "nous:Inherited-alpha"
            : "nous:Work-alpha",
      reasoningEffort: "medium",
      ...(profile === undefined ? {} : { hermesProfileId: profile }),
    },
    {
      equals: (previous, next) => {
        if (mounting) {
          repeatedMountWrites =
            !Object.is(previous, next) && JSON.stringify(previous) === JSON.stringify(next)
              ? repeatedMountWrites + 1
              : 0;
          if (repeatedMountWrites >= 2) {
            result.failureKind = "assertion";
            throw new BehaviorFailure("The create form must settle without repeated equal-valued draft writes.");
          }
        }
        return Object.is(previous, next);
      },
    },
  );
  const signedOut =
    name === "selected-readiness" ||
    name === "selected-loading" ||
    name === "selected-error" ||
    name === "selected-empty" ||
    name === "inherited-readiness" ||
    name === "inherited-runtime-connect" ||
    name === "runtime-ready-error" ||
    name === "blocked-joined" ||
    name === "blocked-connect" ||
    name === "selected-retry";
  const downloadCase = name === "download-missing" || name === "download-retry" || name === "download-cancel";
  const status: AgentStatus = {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "unknown" },
    capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
    message: null,
    fullAccess: true,
    providers: [
      {
        id: "hermes",
        state:
          name === "runtime-ready-error"
            ? "error"
            : downloadCase
              ? "not-installed"
              : signedOut
                ? "sign-in-required"
                : "available",
        version: "fixture",
        message: null,
      },
      {
        id: "codex",
        state: name === "codex-connect" ? "sign-in-required" : "available",
        version: "fixture",
        message: null,
      },
    ],
  };
  const pending: ReturnType<typeof Promise.withResolvers<ClientAgentModelOption[]>>[] = [];
  let modelReads = 0;
  const port = {
    listHermesProfiles: async () => {
      result.requests.push("profiles");
      return ["default", "work"];
    },
    listHermesModels: async (input: { profileId?: string }) => {
      const key = input.profileId ?? "inherit";
      result.requests.push(`models:${key}`);
      modelReads += 1;
      if (name === "selected-retry" && modelReads === 1) throw new Error("The first selected catalog read failed.");
      if (name === "selected-error" || name === "runtime-ready-error")
        throw new Error("The selected profile catalog is unavailable.");
      if (name === "selected-empty") return [];
      if (name === "selected-loading" || name === "selected-retry") {
        const deferred = Promise.withResolvers<ClientAgentModelOption[]>();
        pending.push(deferred);
        return deferred.promise;
      }
      return key === "work" ? work : key === "default" ? canonical : inherited;
    },
  };
  Object.defineProperty(window, "openbot", { configurable: true, value: port });
  const runtime: ProviderRuntimeStatus = {
    phase:
      name === "download-cancel"
        ? "downloading"
        : name === "download-retry"
          ? "download-error"
          : downloadCase
            ? "not-downloaded"
            : "ready",
    progress: name === "download-cancel" ? 40 : null,
    version: downloadCase ? null : "fixture",
    availableVersion: null,
    message: null,
  };
  setCreateContext({
    draft,
    setDraft,
    status,
    models: [...codex, ...inherited],
    submit: async (value = draft()) => {
      if (value.provider === "hermes") {
        const allowed =
          value.hermesProfileId === "work" ? work : value.hermesProfileId === "default" ? canonical : inherited;
        check(
          allowed.some((model) => model.id === value.model),
          "The submitted model must belong to its profile.",
        );
      }
      result.submitted.push({ ...value });
    },
    connect: async (provider) => {
      result.connected.push(provider);
    },
    local: name !== "blocked-joined",
    runtimes: actionCase && name !== "blocked-joined" && name !== "codex-connect" ? { hermes: runtime } : {},
    download: async (provider) => {
      result.downloaded.push(provider);
    },
    cancelDownload: async (provider) => {
      result.canceled.push(provider);
    },
  });
  return {
    draft,
    status,
    mount: () => {
      const view = render(() =>
        sharedCase(name) ? (
          <ProviderModelPicker
            variant="field"
            ariaLabel="Agent model"
            provider="hermes"
            value="nous:Inherited-alpha"
            modelOptions={[...codex, ...inherited]}
            agentStatus={status}
            runtimeStatuses={{ hermes: runtime }}
            canConnectProvider={() => name !== "runtime-ready-error" && name !== "blocked-connect"}
            onChange={() => {}}
            onConnectProvider={async (provider) => {
              result.connected.push(provider);
            }}
            onDownloadProvider={async (provider) => {
              result.downloaded.push(provider);
            }}
            onCancelProviderDownload={async (provider) => {
              result.canceled.push(provider);
            }}
          />
        ) : (
          <WorkspaceAgentSetup />
        ),
      );
      mounting = false;
      return view;
    },
    release: () => {
      for (const deferred of pending) deferred.resolve(work);
    },
  };
}

window.runHermesCreate = async (cases) => {
  configure({ getElementError: (message) => new Error(message ?? "The control was not found.") });
  const report: HermesCreateReport = {
    passed: false,
    interface:
      "Production WorkspaceAgentSetup, Hermes catalog hook, shared FirstAgentSetup, and shared picker in jsdom. Eight typed synthetic context aliases, synthetic catalog IPC, captured create callback. No provider process or native app.",
    cases: [],
  };
  for (const name of cases) {
    const result: HermesCreateResult = {
      name,
      interface: sharedCase(name) ? "shared-picker" : "create-adapter",
      passed: false,
      checks: [],
      requests: [],
      connected: [],
      downloaded: [],
      canceled: [],
      draft: null,
      submitted: [],
    };
    report.cases.push(result);
    const fixture = createFixture(name, result);
    const verify = (value: boolean, message: string) => {
      check(value, message);
      result.checks.push(message);
    };
    try {
      window.hermesCreateProgress(`${name} start`);
      fixture.mount();
      window.hermesCreateProgress(`${name} mounted`);
      if (!sharedCase(name)) await screen.findByRole("button", { name: "Create agent" });
      if (
        name === "download-missing" ||
        name === "download-retry" ||
        name === "download-cancel" ||
        name === "runtime-ready-error" ||
        name === "inherited-runtime-connect" ||
        name === "codex-connect" ||
        name === "blocked-joined" ||
        name === "blocked-connect"
      ) {
        await finishPromiseEvents();
        await openModels(name === "codex-connect" ? "ChatGPT" : "Hermes");
        if (name === "runtime-ready-error") {
          verify(
            !screen.queryByRole("button", { name: "Connect" }),
            "A ready runtime with a selected catalog error must not connect the inherited profile.",
          );
          verify(
            !screen.queryByRole("button", { name: "Download" }),
            "A selected catalog error does not download an installed runtime.",
          );
        } else if (name === "blocked-joined" || name === "blocked-connect") {
          verify(
            !screen.queryByRole("button", { name: "Connect" }),
            name === "blocked-joined"
              ? "A joined host without a Connect route offers no Connect action."
              : "A ready runtime must honor canConnectProvider=false.",
          );
          verify(result.connected.length === 0, "A blocked provider sends no Connect action.");
        } else if (name === "codex-connect" || name === "inherited-runtime-connect") {
          fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
          verify(
            result.connected.join() === (name === "codex-connect" ? "codex" : "hermes"),
            "The available provider Connect route receives its own provider.",
          );
        } else {
          if (name === "download-missing") await screen.findByRole("tab", { name: /^Hermes: Not installed/u });
          const action = name === "download-missing" ? "Download" : name === "download-retry" ? "Retry" : "Cancel";
          fireEvent.click(await screen.findByRole("button", { name: action }));
          verify(
            (name === "download-cancel" ? result.canceled : result.downloaded).join() === "hermes",
            "The runtime action keeps its download, retry, or cancel callback.",
          );
          verify(result.connected.length === 0, "Runtime management does not start Connect.");
        }
      } else if (name === "dormant-work" || name === "dormant-default" || name === "other-provider") {
        const catalog = name === "dormant-default" ? "Canonical" : "Work";
        verify(!screen.queryByRole("button", { name: /^Hermes profile/u }), "Codex keeps the profile selector hidden.");
        await openModels("ChatGPT");
        fireEvent.click(await screen.findByRole("option", { name: /Codex beta/u }));
        await waitFor(() =>
          check(fixture.draft().model === "gpt:Codex-beta", "The Codex choice must update the draft."),
        );
        verify(
          fixture.draft().hermesProfileId === (name === "dormant-default" ? "default" : "work"),
          "A Codex change preserves the dormant profile.",
        );
        if (name === "other-provider") {
          await chooseEffort("ChatGPT", "High");
          await submit();
          verify(
            result.submitted[0]?.provider === "codex" && result.submitted[0]?.reasoningEffort === "high",
            "A Codex draft submits its own model and effort with a dormant Hermes profile.",
          );
        } else {
          await openModels("Hermes");
          await waitFor(() =>
            check(
              Boolean(screen.queryByRole("option", { name: new RegExp(`${catalog} beta`, "u") })),
              "The first Hermes choice must use the dormant selected catalog.",
            ),
          );
          verify(
            !screen.queryByRole("option", { name: /Inherited beta/u }),
            "The first Hermes choice excludes inherited models.",
          );
          fireEvent.click(await screen.findByRole("option", { name: new RegExp(`${catalog} beta`, "u") }));
          await waitFor(() =>
            check(fixture.draft().model === `nous:${catalog}-beta`, "The selected model must enter the draft."),
          );
          await openModels("ChatGPT");
          fireEvent.click(await screen.findByRole("option", { name: /Codex alpha/u }));
          await waitFor(() => check(fixture.draft().provider === "codex", "The draft must switch back to Codex."));
          await openModels("Hermes");
          fireEvent.click(await screen.findByRole("option", { name: new RegExp(`${catalog} alpha`, "u") }));
          await chooseEffort("Hermes", "High");
          await submit();
          verify(
            result.submitted[0]?.model === `nous:${catalog}-alpha` && result.submitted[0]?.reasoningEffort === "high",
            "Provider switching keeps the selected profile catalog and submits its model and effort.",
          );
        }
      } else {
        await waitFor(() =>
          check(
            result.requests.some((request) => request.startsWith("models:")),
            "The catalog request must start.",
          ),
        );
        if (name !== "selected-loading") await finishPromiseEvents();
        if (name === "selected-retry") {
          await screen.findByRole("alert");
          fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
          await waitFor(() =>
            check(
              result.requests.filter((request) => request === "models:work").length === 2,
              "Retry must start a new selected-profile read.",
            ),
          );
          await finishPromiseEvents();
          verify(!screen.queryByRole("alert"), "A pending retry clears the prior selected catalog error.");
          verify(fixture.draft().hermesProfileId === "work", "A pending retry keeps the selected profile.");
          fixture.release();
          await finishPromiseEvents();
          await openModels("Hermes");
          fireEvent.click(await screen.findByRole("option", { name: /Work beta/u }));
          await chooseEffort("Hermes", "High");
          await submit();
          verify(
            result.submitted[0]?.model === "nous:Work-beta" && result.submitted[0]?.reasoningEffort === "high",
            "A successful retry restores selected model and effort creation.",
          );
        } else if (name === "unrelated-draft") {
          const requests = [...result.requests];
          fireEvent.input(await screen.findByRole("textbox", { name: "Name" }), {
            target: { value: "Changed name" },
          });
          fireEvent.input(await screen.findByRole("textbox", { name: "What should this agent help with?" }), {
            target: { value: "Changed purpose" },
          });
          fireEvent.click(await screen.findByRole("button", { name: "Agent face 2" }));
          await finishPromiseEvents();
          verify(
            fixture.draft().name === "Changed name" && fixture.draft().purpose === "Changed purpose",
            "Unrelated fields update through the real create form.",
          );
          verify(
            result.requests.join("\n") === requests.join("\n"),
            "Unrelated draft fields must not restart profile discovery or the selected catalog probe.",
          );
        } else {
          await openModels("Hermes");
          if (name === "selected-loading" || name === "selected-error" || name === "selected-empty") {
            verify(
              !screen.queryByRole("option", { name: /Inherited beta/u }),
              "An unavailable selected catalog offers no inherited model.",
            );
            verify(
              !screen.queryByRole("button", { name: "Connect" }),
              "An unavailable selected catalog must not connect the inherited profile.",
            );
            verify(
              fixture.draft().hermesProfileId === "work",
              "An unavailable selected catalog preserves the draft profile.",
            );
            verify(
              result.submitted.length === 0 && result.connected.length === 0,
              "An unavailable selected catalog sends no create or Connect action.",
            );
          } else if (name === "inherited-readiness") {
            fireEvent.click(await screen.findByRole("option", { name: /Inherited beta/u }));
            flush();
            verify(
              fixture.draft().model === "nous:Inherited-alpha",
              "Inherited signed-out status still blocks an inherited model choice.",
            );
            fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
            verify(result.connected.join() === "hermes", "Inherited Connect keeps the released provider route.");
          } else {
            const catalog = name === "inherited-available" ? "Inherited" : "Work";
            fireEvent.click(await screen.findByRole("option", { name: new RegExp(`${catalog} beta`, "u") }));
            await waitFor(() =>
              check(
                fixture.draft().model === `nous:${catalog}-beta`,
                "A ready selected profile must allow its own create model choice.",
              ),
            );
            await chooseEffort("Hermes", "High");
            await waitFor(() =>
              check(fixture.draft().reasoningEffort === "high", "The create effort choice must update the draft."),
            );
            await chooseEffort("Hermes", "Medium");
            await waitFor(() =>
              check(
                fixture.draft().reasoningEffort === "medium",
                "The reverse create effort choice must update the draft.",
              ),
            );
            await chooseEffort("Hermes", "High");
            await submit();
            const submitted = result.submitted[0];
            verify(
              submitted?.model === `nous:${catalog}-beta` && submitted.reasoningEffort === "high",
              "The create callback receives the selected model and effort.",
            );
            verify(
              submitted?.hermesProfileId === (name === "inherited-available" ? undefined : "work"),
              "The create callback preserves explicit selection or inherited omission.",
            );
            verify(result.connected.length === 0, "A ready catalog does not use Connect.");
            verify(
              fixture.status.providers?.[0]?.state ===
                (name === "selected-readiness" ? "sign-in-required" : "available"),
              "Create selection leaves global Hermes status unchanged.",
            );
          }
        }
      }
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.failureKind ??= error instanceof BehaviorFailure ? "assertion" : "harness";
    } finally {
      window.hermesCreateProgress(`${name} cleanup`);
      result.draft = sharedCase(name) ? null : { ...fixture.draft() };
      cleanup();
      fixture.release();
      await finishPromiseEvents();
    }
  }
  report.passed = report.cases.every((result) => result.passed);
  return report;
};
