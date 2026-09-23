import type { AgentModelOption, AgentProviderStatus, AgentStatus } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { STORY_MODELS } from "../preview/fixtures";
import { ProviderModelPicker } from "./ProviderModelPicker";

const agentStatus: AgentStatus = {
  phase: "ready",
  cliVersion: "0.144.1",
  auth: { kind: "chatgpt", email: "person@example.com" },
  providers: [
    {
      id: "codex",
      state: "available",
      version: "0.144.1",
      message: null,
      email: "person@example.com",
    },
    {
      id: "claude",
      state: "sign-in-required",
      version: null,
      message: "Run `claude auth login` to use Claude.",
      email: null,
    },
    {
      id: "grok",
      state: "not-installed",
      version: null,
      message: "Run `grok login` or set XAI_API_KEY to use Grok.",
      email: null,
    },
  ],
  capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};

describe("ProviderModelPicker", () => {
  it("changes model and effort without closing the combined picker", async () => {
    const onChange = vi.fn();
    const onReasoningEffortChange = vi.fn();
    const [model, setModel] = createSignal("gpt-5.6-luna");
    const [effort, setEffort] = createSignal<"medium" | "xhigh">("medium");
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value={model()}
        reasoningEffort={effort()}
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        onChange={(nextModel, provider) => {
          setModel(nextModel);
          onChange(nextModel, provider);
        }}
        onReasoningEffortChange={(nextEffort) => {
          if (nextEffort === "medium" || nextEffort === "xhigh") setEffort(nextEffort);
          onReasoningEffortChange(nextEffort);
        }}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(dialog).getByRole("option", { name: "GPT-5.6 Sol" }));

    expect(onChange).toHaveBeenCalledWith("gpt-5.6-sol", "codex");
    expect(dialog).toBeInTheDocument();
    const effortSelect = within(dialog).getByRole("button", { name: /Agent reasoning effort/ });
    await fireEvent.pointerDown(effortSelect, { pointerType: "mouse", button: 0 });
    const page = within(document.body);
    expect(await page.findByRole("option", { name: "Medium" })).toBeInTheDocument();
    expect(page.getByRole("option", { name: "High" })).toBeInTheDocument();
    expect(page.queryByRole("option", { name: "Low" })).not.toBeInTheDocument();

    await fireEvent.click(page.getByRole("option", { name: "Extra high" }));
    expect(onReasoningEffortChange).toHaveBeenCalledWith("xhigh");
    expect(effortSelect).toHaveTextContent("Extra high");
    expect(dialog).toBeInTheDocument();
  });

  it("offers the standing grant below Effort, and only where the caller gives one", async () => {
    const onAutoApproveChange = vi.fn();
    const [granted, setGranted] = createSignal(false);
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value="gpt-5.6-luna"
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        autoApprove={granted()}
        onAutoApproveChange={(next) => {
          setGranted(next);
          onAutoApproveChange(next);
        }}
        onChange={vi.fn()}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    const grant = within(dialog).getByRole("switch", { name: "Auto approve this agent's actions" });
    expect(grant).not.toBeChecked();

    await fireEvent.click(grant);
    expect(onAutoApproveChange).not.toHaveBeenCalled();
    let confirmation = await screen.findByRole("alertdialog");
    expect(confirmation).toHaveTextContent("filesystem and network access");
    await fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onAutoApproveChange).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    await fireEvent.click(await view.findByRole("switch", { name: "Auto approve this agent's actions" }));
    confirmation = await screen.findByRole("alertdialog");
    await fireEvent.click(within(confirmation).getByRole("button", { name: "Always allow" }));
    expect(onAutoApproveChange).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const enabled = await view.findByRole("switch", { name: "Auto approve this agent's actions" });
    expect(enabled).toBeChecked();
    await fireEvent.click(enabled);
    expect(onAutoApproveChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reads the grant as on and read-only while Turbo mode covers every agent", async () => {
    const onAutoApproveChange = vi.fn();
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value="gpt-5.6-luna"
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        autoApprove
        autoApproveLocked
        onAutoApproveChange={onAutoApproveChange}
        onChange={vi.fn()}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    const grant = within(dialog).getByRole("switch", { name: "Auto approve this agent's actions" });
    expect(grant).toBeChecked();
    await fireEvent.click(grant);
    expect(onAutoApproveChange).not.toHaveBeenCalled();
  });

  it("shows no standing grant for an agent this computer does not run", async () => {
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value="gpt-5.6-luna"
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        onChange={vi.fn()}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    expect(within(dialog).queryByRole("switch", { name: "Auto approve this agent's actions" })).not.toBeInTheDocument();
  });

  it("shows an unavailable provider without allowing its models", async () => {
    const onChange = vi.fn();
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value="gpt-5.6-luna"
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        onChange={onChange}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    expect(within(dialog).getByRole("tab", { name: /ChatGPT:/ })).toBeInTheDocument();
    const grok = within(dialog).getByRole("tab", { name: /Grok:/ });
    await fireEvent.click(grok);

    expect(grok).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("tabpanel", { name: /Grok:/ })).toHaveTextContent(
      "Run `grok login` or set XAI_API_KEY to use Grok.",
    );

    await fireEvent.click(within(dialog).getByRole("tab", { name: /Claude:/ }));
    expect(within(dialog).getByRole("option", { name: "Claude Opus 5.5, default" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves between providers with the keyboard and closes on Escape or an outside press", async () => {
    const view = render(() => (
      <ProviderModelPicker
        provider="codex"
        value="gpt-5.6-luna"
        modelOptions={STORY_MODELS}
        agentStatus={agentStatus}
        onChange={vi.fn()}
      />
    ));
    const trigger = view.getByRole("button", { name: "Agent model: GPT-5.6 Luna" });

    await fireEvent.click(trigger);
    const dialog = view.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.keyDown(within(dialog).getByRole("tab", { name: /^ChatGPT:/ }), { key: "ArrowUp" });
    expect(within(dialog).getByRole("tab", { name: /^Claude:/ })).toHaveAttribute("aria-selected", "true");

    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.queryByRole("dialog", { name: "Choose agent model" })).not.toBeInTheDocument();

    await fireEvent.click(trigger);
    expect(view.getByRole("dialog", { name: "Choose agent model" })).toBeInTheDocument();
    await fireEvent.pointerDown(document.body);
    expect(view.queryByRole("dialog", { name: "Choose agent model" })).not.toBeInTheDocument();
  });
});

const openCodeModels: AgentModelOption[] = [
  ["openai/gpt", "OpenAI/GPT"],
  ["opencode/free", "OpenCode Zen/Example Free"],
  ["opencode/free/low", "OpenCode Zen/Example Free (low)"],
  ["opencode/free/high", "OpenCode Zen/Example Free (high)"],
  ["opencode/unknown", "OpenCode Zen/Unknown price"],
].map(([id, name]) => ({
  provider: "opencode",
  id,
  name,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
}));

const openCodeBase: AgentProviderStatus = {
  id: "opencode",
  state: "not-installed",
  version: "1.18.30",
  message: null,
  email: null,
};

function withOpenCodeProvider(overrides: Partial<AgentProviderStatus>): AgentProviderStatus[] {
  return [...(agentStatus.providers ?? []), { ...openCodeBase, ...overrides }];
}

async function openOpenCodePicker() {
  const onChange = vi.fn();
  const [model, setModel] = createSignal("opencode/free/low");
  const view = render(() => (
    <ProviderModelPicker
      provider="opencode"
      value={model()}
      modelOptions={openCodeModels}
      agentStatus={agentStatus}
      onChange={(id, provider) => {
        setModel(id);
        onChange(id, provider);
      }}
    />
  ));
  await fireEvent.click(view.getByRole("button", { name: /Agent model:/ }));
  return { view, onChange, dialog: within(view.getByRole("dialog", { name: "Choose agent model" })) };
}

it("puts the service that holds a free model first and keeps one selected row per model", async () => {
  const { dialog } = await openOpenCodePicker();
  expect(dialog.getAllByRole("option").map((option) => option.getAttribute("aria-label"))).toEqual([
    "Example Free",
    "Unknown price",
    "GPT",
  ]);
  expect(dialog.getByRole("option", { name: "Example Free" })).toHaveAttribute("aria-selected", "true");
});

it("searches by service or model and restores the list when search is cleared", async () => {
  const { dialog } = await openOpenCodePicker();
  const search = dialog.getByRole("textbox", { name: "Search models" });
  await fireEvent.input(search, { target: { value: "openai" } });
  expect(dialog.getAllByRole("option").map((option) => option.textContent)).toEqual(["GPT"]);
  await fireEvent.input(search, { target: { value: "unknown price" } });
  expect(dialog.getAllByRole("option").map((option) => option.textContent)).toEqual(["Unknown price"]);
  await fireEvent.input(search, { target: { value: "missing" } });
  expect(dialog.getByRole("status")).toHaveTextContent("No models match your search.");
  await fireEvent.input(search, { target: { value: "" } });
  expect(dialog.getAllByRole("option")).toHaveLength(3);
});

it("selects OpenCode reasoning model IDs and can return to the default model", async () => {
  const { dialog, onChange } = await openOpenCodePicker();
  const effort = dialog.getByRole("button", { name: /Agent reasoning effort/ });
  expect(effort).toHaveTextContent("Low");
  await fireEvent.pointerDown(effort, { pointerType: "mouse", button: 0 });
  await fireEvent.click(await within(document.body).findByRole("option", { name: "High" }));
  expect(onChange).toHaveBeenLastCalledWith("opencode/free/high", "opencode");
  await fireEvent.pointerDown(effort, { pointerType: "mouse", button: 0 });
  await fireEvent.click(await within(document.body).findByRole("option", { name: "Default" }));
  expect(onChange).toHaveBeenLastCalledWith("opencode/free", "opencode");
});

it("shows the sign-in message and a Connect action when OpenCode lists no models", async () => {
  const onConnect = vi.fn();
  const status: AgentStatus = {
    ...agentStatus,
    providers: withOpenCodeProvider({
      state: "sign-in-required",
      message: "OpenCode listed no model. Add an OpenCode Go key to continue.",
    }),
  };
  const view = render(() => (
    <ProviderModelPicker
      provider="opencode"
      value="opencode/free"
      modelOptions={[]}
      agentStatus={status}
      onConnectProvider={onConnect}
      onChange={vi.fn()}
    />
  ));
  await fireEvent.click(view.getByRole("button", { name: /Agent model:/ }));
  const dialog = within(view.getByRole("dialog", { name: "Choose agent model" }));
  expect(dialog.getByRole("status")).toHaveTextContent("OpenCode listed no model.");
  await fireEvent.click(dialog.getByRole("button", { name: "Connect" }));
  expect(onConnect).toHaveBeenCalledWith("opencode");
});

// Main keeps the provider "connecting" for the whole install it wraps around a download, so this
// is the state of every download this panel starts, and Cancel is the only way to stop one.
it("keeps Cancel on a connecting provider while its download runs", async () => {
  const onCancel = vi.fn();
  const status: AgentStatus = {
    ...agentStatus,
    providers: withOpenCodeProvider({
      state: "not-installed",
      version: null,
      connectionState: "connecting",
    }),
  };
  const view = render(() => (
    <ProviderModelPicker
      provider="opencode"
      value="opencode/free"
      modelOptions={[]}
      agentStatus={status}
      runtimeStatuses={{ opencode: { phase: "downloading", progress: 40, message: null, version: null } }}
      onCancelProviderDownload={onCancel}
      onChange={vi.fn()}
    />
  ));
  await fireEvent.click(view.getByRole("button", { name: /Agent model:/ }));
  const dialog = within(view.getByRole("dialog", { name: "Choose agent model" }));
  expect(dialog.getByRole("status")).toHaveTextContent("Downloading 40%");
  await fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledWith("opencode");
});
