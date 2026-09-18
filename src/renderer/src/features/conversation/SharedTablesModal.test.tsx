import type { DeleteSharedTableInput, SharedTable } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "../../data";
import { STORY_AGENTS } from "../../preview/fixtures";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { SharedTablesModal } from "./SharedTablesModal";

const people: SharedTable = { name: "people", ownerAgentId: "chief", rowCount: 214 };
const orphaned: SharedTable = { name: "handled_mail", ownerAgentId: null, rowCount: null };

let tableState: SharedTable[];
let listTables: Mock<() => Promise<SharedTable[]>>;
let deleteTable: Mock<(input: DeleteSharedTableInput) => Promise<void>>;
let activeMock: MockOpenBotControls | undefined;
const agents: AgentProfile[] = STORY_AGENTS;

afterEach(() => {
  activeMock?.dispose();
  activeMock = undefined;
});

beforeEach(() => {
  tableState = [people, orphaned];
  listTables = vi.fn(async () => [...tableState]);
  deleteTable = vi.fn(async (input: DeleteSharedTableInput) => {
    tableState = tableState.filter((table) => table.name !== input.name);
  });
  activeMock = createMockOpenBot();
  activeMock.api.agent.listTables = listTables;
  activeMock.api.agent.deleteTable = deleteTable;
  window.openbot = activeMock.api;
});

describe("SharedTablesModal", () => {
  it("names the agent that keeps each set of records and says when nobody does", async () => {
    const onCountChange = vi.fn();
    render(() => <SharedTablesModal agents={agents} open onOpenChange={vi.fn()} onCountChange={onCountChange} />);

    expect(await screen.findByRole("dialog", { name: "Saved data" })).toBeInTheDocument();
    expect(await screen.findByText("people")).toBeInTheDocument();
    expect(screen.getByText("214 records · Kept by Chief")).toBeInTheDocument();
    expect(screen.getByText(/not counted · Made outside OpenBot/)).toBeInTheDocument();
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(2));
  });

  it("asks before it deletes, then removes the row", async () => {
    const onCountChange = vi.fn();
    render(() => <SharedTablesModal agents={agents} open onOpenChange={vi.fn()} onCountChange={onCountChange} />);

    await fireEvent.click(await screen.findByRole("button", { name: "Delete people" }));
    expect(deleteTable).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteTable).toHaveBeenCalledWith({ name: "people" }));
    await waitFor(() => expect(screen.queryByText("people")).not.toBeInTheDocument());
    expect(screen.getByText("handled_mail")).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });
});
