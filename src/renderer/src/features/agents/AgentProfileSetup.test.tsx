import type { AgentProfileDraft, GenerateAgentProfileInput, SaveAgentProfileInput } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { AgentProfileSetup } from "./AgentProfileSetup";

const draft: AgentProfileDraft = {
  name: "Researcher",
  title: "Research assistant",
  description: "Compare sources.",
  avatarSeed: "profile:research",
  avatarHue: 215,
  sectionId: null,
};

it("lets the user revise and edit a generated profile before saving", async () => {
  let saved: SaveAgentProfileInput | undefined;
  const generate = vi.fn(async (_input: GenerateAgentProfileInput) => ({ ...draft }));
  render(() => (
    <AgentProfileSetup
      sections={[]}
      generate={generate}
      save={async (input) => {
        saved = input;
      }}
      onClose={() => undefined}
    />
  ));
  await fireEvent.input(screen.getByRole("textbox", { name: "Describe your agent" }), {
    target: { value: "Research science" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Generate profile" }));
  const instructions = await screen.findByRole("textbox", { name: "Standing instructions" });
  expect(saved).toBeUndefined();
  await fireEvent.input(instructions, { target: { value: "Cite primary sources." } });
  await fireEvent.click(screen.getByRole("button", { name: "Revise profile" }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  expect(generate.mock.calls[1]?.[0]).toMatchObject({ draft: { description: "Cite primary sources." } });
  await fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Science partner" } });
  await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(saved).toBeDefined());
  expect(saved?.draft).toMatchObject({ name: "Science partner", description: "Compare sources.", avatarHue: 215 });
});

it("retains edits after a failed save so the user can retry", async () => {
  let saved: SaveAgentProfileInput | undefined;
  const save = vi.fn(async (input: SaveAgentProfileInput, _pending?: SaveAgentProfileInput) => {
    if (!saved) {
      saved = input;
      throw new Error("Connection lost");
    }
  });
  render(() => (
    <AgentProfileSetup
      initialDraft={draft}
      sections={[]}
      generate={async () => draft}
      save={save}
      onClose={() => undefined}
    />
  ));
  await fireEvent.input(screen.getByRole("textbox", { name: "Describe your agent" }), {
    target: { value: "Improve it" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Generate profile" }));
  await screen.findByRole("button", { name: "Revise profile" });
  await fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "My researcher" } });
  await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("My researcher");
  await fireEvent.click(screen.getByRole("button", { name: "Revise profile" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Create agent" })).toBeEnabled());
  await fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Edited after failure" } });
  await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[1]).toEqual(saved);
  expect(save.mock.calls[1]?.[0].operationId).not.toBe(saved?.operationId);
  expect(save.mock.calls[1]?.[0].draft.name).toBe("Edited after failure");
});

it("shows generation failure without changing or saving the existing profile", async () => {
  const save = vi.fn(async () => undefined);
  render(() => (
    <AgentProfileSetup
      agentId="agent-existing"
      initialDraft={draft}
      sections={[]}
      generate={async () => {
        throw new Error("Provider offline");
      }}
      save={save}
      onClose={() => undefined}
    />
  ));
  await fireEvent.input(screen.getByRole("textbox", { name: "Describe your agent" }), {
    target: { value: "Improve it" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Generate profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider offline");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Researcher");
  expect(save).not.toHaveBeenCalled();
});

it("discards an unfinished generation when review is cancelled", async () => {
  const pending = Promise.withResolvers<AgentProfileDraft>();
  const save = vi.fn(async () => undefined);
  const closed = vi.fn();
  const view = render(() => (
    <AgentProfileSetup sections={[]} generate={() => pending.promise} save={save} onClose={closed} />
  ));
  await fireEvent.input(screen.getByRole("textbox", { name: "Describe your agent" }), {
    target: { value: "Research" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Generate profile" }));
  expect(screen.getByRole("button", { name: "Generating profile…" })).toBeDisabled();
  await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(closed).toHaveBeenCalledOnce();
  view.unmount();
  pending.resolve({ ...draft });
  await pending.promise;
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
