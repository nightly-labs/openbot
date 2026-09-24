import type { Routine } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { RoutineChatCard } from "./RoutineChatCard";

const routine: Routine = {
  id: "routine-1",
  agentId: "chief",
  name: "Morning brief",
  instruction: "Summarize the overnight changes.",
  active: true,
  timezone: "Europe/Warsaw",
  trigger: {
    id: "trigger-1",
    routineId: "routine-1",
    schedule: { kind: "weekdays", time: "07:00" },
    nextRunAt: "2026-08-26T05:00:00.000Z",
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
  },
  createdAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};

const workdaysAndSaturday = {
  kind: "advanced",
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  days: { kind: "days-of-week", days: [1, 2, 3, 4, 5, 6] },
  time: { kind: "at-time", time: "07:00" },
};

let mock: MockOpenBotControls | undefined;

function setupOpenBot(): MockOpenBotControls {
  mock?.dispose();
  mock = createMockOpenBot({ routines: { chief: [routine] } });
  window.openbot = mock.api;
  return mock;
}

afterEach(() => {
  mock?.dispose();
  mock = undefined;
  vi.restoreAllMocks();
});

async function addSaturday(): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "Days: Weekdays" }));
  const saturday = await screen.findByRole("button", { name: "Saturday" });
  await fireEvent.click(saturday);
  await fireEvent.keyDown(saturday, { key: "Escape" });
}

describe("RoutineChatCard", () => {
  it("saves a changed schedule at once", async () => {
    const updateRoutine = vi.spyOn(setupOpenBot().api.agent, "updateRoutine");
    render(() => <RoutineChatCard action="created" routine={routine} agentId="chief" latest onOpenRoutine={vi.fn()} />);

    await addSaturday();
    await waitFor(() =>
      expect(updateRoutine).toHaveBeenCalledWith({
        agentId: "chief",
        routineId: "routine-1",
        name: "Morning brief",
        instruction: "Summarize the overnight changes.",
        active: true,
        schedule: workdaysAndSaturday,
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });

  it("saves a time edit once, when its popover closes", async () => {
    const updateRoutine = vi.spyOn(setupOpenBot().api.agent, "updateRoutine");
    render(() => <RoutineChatCard action="created" routine={routine} agentId="chief" latest onOpenRoutine={vi.fn()} />);

    await fireEvent.click(screen.getByRole("button", { name: /^Time:/ }));
    const hour = await screen.findByRole("textbox", { name: "Time hour" });
    await fireEvent.input(hour, { target: { value: "8" } });
    await fireEvent.keyDown(hour, { key: "Enter" });
    await fireEvent.keyUp(hour, { key: "Enter" });
    const minute = screen.getByRole("textbox", { name: "Time minute" });
    minute.focus();
    await fireEvent.input(minute, { target: { value: "30" } });
    // The typed minute is not committed yet. Closing the popover commits it with the hour.
    await fireEvent.keyDown(minute, { key: "Escape" });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(updateRoutine).toHaveBeenCalledOnce();
    expect(updateRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { kind: "weekdays", time: "08:30" } }),
    );
  });

  it("saves a change back to the old schedule while an earlier save runs", async () => {
    const agent = setupOpenBot().api.agent;
    const saveRoutine = agent.updateRoutine.bind(agent);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updateRoutine = vi.spyOn(agent, "updateRoutine").mockImplementationOnce(async (input) => {
      await held;
      return saveRoutine(input);
    });
    render(() => <RoutineChatCard action="created" routine={routine} agentId="chief" latest onOpenRoutine={vi.fn()} />);

    await addSaturday();
    await fireEvent.click(screen.getByRole("button", { name: /^Days:/ }));
    const saturday = await screen.findByRole("button", { name: "Saturday" });
    await fireEvent.click(saturday);
    await fireEvent.keyDown(saturday, { key: "Escape" });
    release();

    await waitFor(() => expect(updateRoutine).toHaveBeenCalledTimes(2));
    expect(updateRoutine).toHaveBeenLastCalledWith(
      expect.objectContaining({ schedule: { kind: "weekdays", time: "07:00" } }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(screen.getByRole("button", { name: "Days: Weekdays" })).toBeInTheDocument();
  });

  it("shows why a save failed and puts the saved schedule back", async () => {
    vi.spyOn(setupOpenBot().api.agent, "updateRoutine").mockRejectedValue(new Error("The routine is busy."));
    render(() => <RoutineChatCard action="updated" routine={routine} agentId="chief" latest onOpenRoutine={vi.fn()} />);

    await addSaturday();

    expect(await screen.findByRole("alert")).toHaveTextContent("The routine is busy.");
    expect(screen.getByRole("button", { name: "Days: Weekdays" })).toBeInTheDocument();
  });

  it("is read-only when a later card changed the same routine", async () => {
    setupOpenBot();
    const onShowLatest = vi.fn();
    render(() => (
      <RoutineChatCard
        action="created"
        routine={routine}
        agentId="chief"
        latest={false}
        onOpenRoutine={vi.fn()}
        onShowLatest={onShowLatest}
      />
    ));

    expect(screen.getByText("Changed later in this chat.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Days: Weekdays" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Show latest" }));
    expect(onShowLatest).toHaveBeenCalledOnce();
  });
});
