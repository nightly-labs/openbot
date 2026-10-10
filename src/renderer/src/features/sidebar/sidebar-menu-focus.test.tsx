import { Dialog, DropdownMenu } from "@openbot/ui";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarProps } from "@openbot/ui/features/sidebar/sidebar-types";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

function renderSidebar(overrides: Partial<SidebarProps> = {}, extra?: () => JSX.Element) {
  const onMutateLayout = vi.fn(async () => {});
  const noop = () => {};
  const view = render(() => (
    <>
      <button type="button">Previous focus</button>
      <textarea aria-label="Conversation draft" />
      <Sidebar
        serverName="Test server"
        agents={[]}
        activeAgentId=""
        people={[]}
        directThreads={[]}
        activeDirectMemberId={null}
        agentStates={{}}
        agentMoods={{}}
        layout={{ revision: 1, sections: [], order: ["people", "unassigned"], agentAssignments: {}, agentOrder: [] }}
        collapsedSectionIds={[]}
        onMutateLayout={onMutateLayout}
        onToggleSection={noop}
        pinnedItems={[]}
        peopleOrder={[]}
        onPin={noop}
        onUnpin={noop}
        onReorderPinned={noop}
        onReorderPeople={noop}
        onSelectAgent={noop}
        onSelectPerson={noop}
        onCreateAgent={noop}
        onEditAgent={noop}
        onDeleteAgent={async () => {}}
        compact={false}
        onExpand={noop}
        onOpenMarketplace={noop}
        onOpenSearch={noop}
        {...overrides}
      />
      {extra?.()}
    </>
  ));
  return { onMutateLayout, unmount: view.unmount };
}

// Timers and frames are independent scheduler inputs, not elapsed-time barriers.
function controlCloseSchedule() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  return {
    async frame() {
      for (const [id, callback] of Array.from(frames)) {
        frames.delete(id);
        callback(performance.now());
        await Promise.resolve();
      }
    },
    async close() {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runOnlyPendingTimersAsync();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ["timer first", "pointer"],
  ["frames first", "pointer"],
  ["timer first", "keyboard"],
  ["frames first", "keyboard"],
])("keeps the real plus editor usable when %s with %s selection", async (order, method) => {
  const { onMutateLayout } = renderSidebar();
  const schedule = controlCloseSchedule();
  const trigger = screen.getByRole("button", { name: "New agent or channel" });
  trigger.focus();
  const draft = screen.getByRole("textbox", { name: "Conversation draft" });
  await fireEvent.input(draft, { target: { value: "Keep the unsent body" } });
  if (method === "keyboard") await fireEvent.keyDown(trigger, { key: "Enter" });
  else await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New section" });
  if (method === "keyboard") {
    await finishClose(schedule);
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(item).toHaveFocus();
    await fireEvent.keyDown(item, { key: "Enter" });
  } else await fireEvent.pointerUp(item, { button: 0 });
  if (order === "timer first") await schedule.close();
  await schedule.frame();
  await schedule.frame();
  await schedule.frame();
  if (order === "frames first") await schedule.close();
  await schedule.frame();
  await schedule.frame();
  const editor = screen.getByRole("textbox", { name: "New section name" });
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "create", name: "Research" });
  expect(draft).toHaveValue("Keep the unsent body");
});

async function finishClose(schedule: ReturnType<typeof controlCloseSchedule>) {
  await schedule.close();
  await schedule.frame();
  await schedule.frame();
}

it.each([true, false])("hands the actual free-area menu to an editor with previous focus=%s", async (connected) => {
  renderSidebar();
  const previous = screen.getByRole("button", { name: "Previous focus" });
  if (connected) previous.focus();
  else previous.remove();
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  const item = await screen.findByRole("menuitem", { name: "New section" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  expect(screen.getByRole("textbox", { name: "New section name" })).toHaveFocus();
});

it("hands a real Move to submenu to the editor and preserves the selected chat assignment", async () => {
  const { onMutateLayout } = renderSidebar({
    channels: [
      {
        id: "room",
        name: "Project room",
        title: "",
        instructions: "",
        members: [],
        leadAgentId: null,
        archived: false,
        revision: 1,
        createdAt: "2026-10-01T00:00:00Z",
        unreadCount: 0,
        activeTasks: 0,
        lastMessage: null,
      },
    ],
  });
  const row = screen.getByRole("button", { name: /^Project room\./ });
  row.focus();
  await fireEvent.contextMenu(row);
  const move = await screen.findByRole("menuitem", { name: "Move to" });
  await fireEvent.keyDown(move, { key: "ArrowRight" });
  const item = within(await screen.findByRole("menu", { name: "Move to" })).getByRole("menuitem", {
    name: "New section",
  });
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  const editor = screen.getByRole("textbox", { name: "New section name" });
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "create", name: "Research", agentId: "room" });
  expect(screen.getByRole("button", { name: /^Project room\./ })).toBeInTheDocument();
});

it("renames through the actual header menu after its trigger disconnects", async () => {
  const { onMutateLayout } = renderSidebar({
    layout: {
      revision: 1,
      sections: [{ id: "research", name: "Research" }],
      order: ["people", "unassigned", "research"],
      agentAssignments: {},
      agentOrder: [],
    },
  });
  const trigger = screen.getByRole("button", { name: "Research" });
  trigger.focus();
  await fireEvent.contextMenu(trigger);
  const item = await screen.findByRole("menuitem", { name: "Rename" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  const editor = screen.getByRole("textbox", { name: "Rename section" });
  expect(trigger.isConnected).toBe(false);
  expect(editor).toHaveFocus();
  expect(editor).toHaveValue("Research");
  await fireEvent.input(editor, { target: { value: "Planning" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "rename", sectionId: "research", name: "Planning" });
});

async function openEditor() {
  const trigger = screen.getByRole("button", { name: "New agent or channel" });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: "New section" });
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  return { editor: screen.getByRole("textbox", { name: "New section name" }), schedule, trigger };
}

it.each(["Escape", "outside"])("keeps editor cancellation on %s", async (dismiss) => {
  const { onMutateLayout } = renderSidebar();
  const { editor } = await openEditor();
  await fireEvent.input(editor, { target: { value: "Unfinished" } });
  if (dismiss === "Escape") await fireEvent.keyDown(editor, { key: "Escape" });
  else {
    screen.getByRole("button", { name: "Previous focus" }).focus();
    await Promise.resolve();
  }
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
  expect(onMutateLayout).not.toHaveBeenCalled();
});

it("keeps a saving editor on blur and submits Enter only once", async () => {
  let complete: (() => void) | undefined;
  const onMutateLayout = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  renderSidebar({ onMutateLayout });
  const { editor } = await openEditor();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await fireEvent.blur(editor);
  expect(editor).toBeInTheDocument();
  expect(editor).toBeDisabled();
  expect(onMutateLayout).toHaveBeenCalledTimes(1);
  complete?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
});

it("keeps validation and failed saves editable for another attempt", async () => {
  const onMutateLayout = vi.fn().mockRejectedValueOnce(new Error("Try again")).mockResolvedValueOnce(undefined);
  renderSidebar({ onMutateLayout });
  const { editor } = await openEditor();
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(screen.getByRole("alert")).toHaveTextContent("Section name is required.");
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await Promise.resolve();
  expect(editor).toHaveFocus();
  expect(editor).not.toBeDisabled();
  expect(editor).toHaveValue("Research");
  await fireEvent.input(editor, { target: { value: "Planning" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout.mock.calls).toEqual([
    [{ type: "create", name: "Research" }],
    [{ type: "create", name: "Planning" }],
  ]);
});

it.each(["Escape", "outside"])("restores the plus trigger on ordinary %s dismissal", async (dismiss) => {
  renderSidebar();
  const schedule = controlCloseSchedule();
  const trigger = screen.getByRole("button", { name: "New agent or channel" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu");
  const outside = screen.getByText("Previous focus");
  await finishClose(schedule);
  if (dismiss === "Escape") await fireEvent.keyDown(menu, { key: "Escape" });
  else await fireEvent.pointerDown(outside, { button: 0 });
  await finishClose(schedule);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
});

it("does not let old restore callbacks steal a rapidly reopened menu or its next editor", async () => {
  renderSidebar();
  const trigger = screen.getByRole("button", { name: "New agent or channel" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu");
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(menu, { key: "Escape" });
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = screen.getByRole("menuitem", { name: "New section" });
  item.focus();
  await schedule.frame();
  await schedule.frame();
  expect(menu).toHaveFocus();
  expect(trigger).not.toHaveFocus();
  item.focus();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(screen.getByRole("textbox", { name: "New section name" })).toHaveFocus();
});

it("hands the real New channel menu action to a Dialog without an expired menu restore", async () => {
  const [open, setOpen] = createSignal(false);
  renderSidebar({ onCreateChannel: () => setOpen(true) }, () => (
    <Dialog.Root open={open()} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Content>
          <Dialog.Title>New channel</Dialog.Title>
          <input aria-label="Channel name" />
          <Dialog.CloseButton>Cancel</Dialog.CloseButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ));
  const trigger = screen.getByRole("button", { name: "New agent or channel" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New channel" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  const dialog = screen.getByRole("dialog", { name: "New channel" });
  expect(within(dialog).getByRole("textbox", { name: "Channel name" })).toHaveFocus();
  await schedule.frame();
  await schedule.frame();
  expect(within(dialog).getByRole("textbox", { name: "Channel name" })).toHaveFocus();
  await fireEvent.keyDown(dialog, { key: "Escape" });
  await finishClose(schedule);
  expect(screen.queryByRole("dialog", { name: "New channel" })).not.toBeInTheDocument();
});

it("keeps ordinary Item selection immediate and a non-closing Item open", async () => {
  const select = vi.fn();
  render(() => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item closeOnSelect={false} onSelect={select}>
            Keep open
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await fireEvent.pointerDown(screen.getByRole("button", { name: "Actions" }), { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "Keep open" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  expect(select).toHaveBeenCalledTimes(1);
  await finishClose(schedule);
  expect(item).toBeInTheDocument();
});

it("drops a selected handoff when the menu owner unmounts", async () => {
  const onCreateChannel = vi.fn();
  const { unmount } = renderSidebar({ onCreateChannel });
  await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New channel" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  unmount();
  await finishClose(schedule);
  expect(onCreateChannel).not.toHaveBeenCalled();
});

it("discards an old selection when a controlled menu reopens before its exit", async () => {
  const [open, setOpen] = createSignal(false);
  const action = vi.fn();
  render(() => (
    <DropdownMenu.Root open={open()} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelectAfterClose={action}>Open editor</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  const trigger = screen.getByRole("button", { name: "Actions" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "Open editor" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await vi.advanceTimersByTimeAsync(1);
  setOpen(true);
  await Promise.resolve();
  await finishClose(schedule);
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByRole("menuitem", { name: "Open editor" })).toBeInTheDocument();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(action).toHaveBeenCalledTimes(1);
});

it("retains initial focus and ordinary dismissal for a default-open menu", async () => {
  const schedule = controlCloseSchedule();
  render(() => (
    <DropdownMenu.Root defaultOpen>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item>Read</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await finishClose(schedule);
  const menu = screen.getByRole("menu");
  expect(menu).toHaveFocus();
  const trigger = screen.getByRole("button", { name: "Actions", hidden: true });
  await fireEvent.keyDown(menu, { key: "Escape" });
  await finishClose(schedule);
  expect(trigger).toHaveFocus();
});

it("waits for an actual controlled close rather than a rejected close request", async () => {
  const action = vi.fn();
  const onOpenChange = vi.fn();
  const schedule = controlCloseSchedule();
  render(() => (
    <DropdownMenu.Root open onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelectAfterClose={action}>Open editor</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await finishClose(schedule);
  const item = screen.getByRole("menuitem", { name: "Open editor" });
  item.focus();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(action).not.toHaveBeenCalled();
  expect(item).toHaveFocus();
});
