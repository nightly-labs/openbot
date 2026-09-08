import { type AgentAnalytics, analyticsRange, emptyAnalyticsTotals } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installOpenbotStub } from "../../app-test-harness";
import { AgentUsagePanel } from "./AgentUsagePanel";

beforeEach(installOpenbotStub);
function result(agentId = "a"): AgentAnalytics {
  return {
    ...analyticsRange(agentId),
    collectionStartedAt: new Date().toISOString(),
    updatedAt: null,
    totals: emptyAnalyticsTotals(),
    daily: [],
    models: [],
  };
}
function show() {
  return render(() => (
    <AgentUsagePanel agentId="a" agentName="Research" serverId="host-a" hostName="Team" onBack={() => {}} />
  ));
}
describe("Agent usage", () => {
  it("starts with all agents and returns to combined totals after filtering", async () => {
    vi.mocked(window.openbot.agent.getHostAnalytics).mockImplementation(async (input) => ({
      ...result(),
      ...input,
      totals: {
        ...emptyAnalyticsTotals(),
        sessions: input.agentId ? 1 : 3,
        processedTokens: input.agentId ? 100 : 300,
      },
    }));
    render(() => <AgentUsagePanel serverId="host-a" hostName="Team" onBack={() => {}} />);
    const summary = await screen.findByRole("region", { name: "Usage summary" });
    expect(summary).toHaveTextContent("3 sessions");
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Usage agents/ }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.click(await screen.findByRole("option", { name: "Chief" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("region", { name: "Usage summary" })).toHaveTextContent("1 session"),
    );
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Usage agents/ }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.click(await screen.findByRole("option", { name: "All agents" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("region", { name: "Usage summary" })).toHaveTextContent("3 sessions"),
    );
  });
  it("loads usage, switches dates, and shows empty data", async () => {
    vi.mocked(window.openbot.agent.getHostAnalytics).mockImplementation(async (input) => ({ ...result(), ...input }));
    show();
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No usage recorded"));
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Usage period/ }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.click(await screen.findByRole("option", { name: "7 days" }));
    await screen.findByRole("status");
    const input = vi.mocked(window.openbot.agent.getHostAnalytics).mock.calls.at(-1);
    expect(input).toEqual([analyticsRange("a", 7), "host-a"]);
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Usage period/ }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.click(await screen.findByRole("option", { name: "Custom range" }));
    await fireEvent.input(screen.getByLabelText("Start date"), { target: { value: analyticsRange("a").endDate } });
    await vi.waitFor(() =>
      expect(window.openbot.agent.getHostAnalytics).toHaveBeenLastCalledWith(
        { ...analyticsRange("a"), startDate: analyticsRange("a").endDate },
        "host-a",
      ),
    );
  });
  it("shows an error and retries the request", async () => {
    vi.mocked(window.openbot.agent.getHostAnalytics)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load usage");
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("This host does not support agent analytics"),
    );
  });
  it("discards data from a previous host even when the agent id is the same", async () => {
    let completeOld: (value: AgentAnalytics) => void = () => {
      throw new Error("No pending request");
    };
    const pending = new Promise<AgentAnalytics>((resolve) => {
      completeOld = resolve;
    });
    vi.mocked(window.openbot.agent.getHostAnalytics).mockReturnValueOnce(pending).mockResolvedValueOnce(null);
    const [server, setServer] = createSignal("host-a");
    render(() => (
      <AgentUsagePanel agentId="a" agentName="Research" serverId={server()} hostName={server()} onBack={() => {}} />
    ));
    await vi.waitFor(() => expect(window.openbot.agent.getHostAnalytics).toHaveBeenCalled());
    setServer("host-b");
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("This host does not support"));
    completeOld(result());
    await pending;
    flush();
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("This host does not support"));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("explains partial totals and exposes the daily chart values as a table", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "SPAN" ? new DOMRect(0, 0, 40, 16) : new DOMRect(0, 0, 640, 300);
    });
    const data = result();
    data.totals = { ...data.totals, turns: 1, missingUsageTurns: 1, estimatedCostUsd: 0.00000002 };
    data.daily = [
      { ...emptyAnalyticsTotals(), estimatedCostUsd: 0.01, processedTokens: 350, date: data.startDate },
      { ...emptyAnalyticsTotals(), estimatedCostUsd: 0.02, processedTokens: 700, date: data.endDate },
    ];
    vi.mocked(window.openbot.agent.getHostAnalytics).mockResolvedValue(data);
    show();
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Partial data"));
    expect(within(screen.getByRole("region", { name: "Usage summary" })).getByText("$0.00000002")).toBeInTheDocument();
    const chartDate = new Date(`${data.endDate}T12:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(
      await within(screen.getByRole("img", { name: /Daily estimated/ })).findByText(chartDate),
    ).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /Daily estimated/ });
    await fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("0.01 USD");
    expect(screen.getByRole("table", { name: "Usage by model" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "View daily data" }));
    await vi.waitFor(() => expect(screen.getByRole("table", { name: "Daily usage and cost" })).toHaveFocus());
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Usage metric/ }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.click(await screen.findByRole("option", { name: "Tokens" }));
    expect(screen.getByRole("img", { name: /Daily processed tokens/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Usage summary" })).getByText("Known processed tokens", {
        exact: false,
      }),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    expect(screen.getByRole("table", { name: "Usage by model" })).toBeInTheDocument();
  });
});
