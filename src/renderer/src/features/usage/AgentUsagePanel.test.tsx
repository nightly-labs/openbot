import { analyticsRange, emptyAnalyticsTotals, type HostAnalytics } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installOpenbotStub } from "../../app-test-harness";
import { AgentUsagePanel } from "./AgentUsagePanel";

beforeEach(installOpenbotStub);
function result(agentId = "a"): HostAnalytics {
  return {
    ...analyticsRange(agentId),
    collectionStartedAt: new Date().toISOString(),
    updatedAt: null,
    totals: emptyAnalyticsTotals(),
    daily: [],
    models: [],
    agents: [],
    providerDaily: [],
  };
}
async function pick(filter: string, option: string) {
  await fireEvent.pointerDown(screen.getByRole("button", { name: new RegExp(`^${filter}`) }), {
    pointerType: "mouse",
    button: 0,
  });
  await fireEvent.click(await screen.findByRole("option", { name: option }));
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
      agents: [
        { ...emptyAnalyticsTotals(), agentId: "chief", processedTokens: 200, share: 0.666 },
        { ...emptyAnalyticsTotals(), agentId: "ghost-agent", processedTokens: 100, share: 0.333 },
      ],
    }));
    render(() => <AgentUsagePanel serverId="host-a" hostName="Team" onBack={() => {}} />);
    const summary = await screen.findByRole("region", { name: "Usage summary" });
    expect(summary).toHaveTextContent("3 sessions");
    // A report row names an agent by id, so the table has to join it to the agent list the
    // panel read, and still name an agent the list does not carry.
    await fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    const agents = await screen.findByRole("table", { name: "Usage by agent" });
    expect(within(agents).getByRole("rowheader", { name: "Chief" })).toBeInTheDocument();
    expect(within(agents).getByRole("rowheader", { name: "ghost-agent" })).toBeInTheDocument();
    await pick("Usage agents", "Chief");
    await vi.waitFor(() =>
      expect(screen.getByRole("region", { name: "Usage summary" })).toHaveTextContent("1 session"),
    );
    await pick("Usage agents", "All agents");
    await vi.waitFor(() =>
      expect(screen.getByRole("region", { name: "Usage summary" })).toHaveTextContent("3 sessions"),
    );
  });
  it("loads usage, switches the period, and shows empty data", async () => {
    vi.mocked(window.openbot.agent.getHostAnalytics).mockImplementation(async (input) => ({ ...result(), ...input }));
    show();
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No usage recorded"));
    await pick("Usage period", "7 days");
    await screen.findByRole("status");
    const input = vi.mocked(window.openbot.agent.getHostAnalytics).mock.calls.at(-1);
    expect(input).toEqual([analyticsRange("a", 7), "host-a"]);
    // A year is the widest period, and its label carries no day count, so the request
    // has to prove the label maps to 365 days.
    await pick("Usage period", "1 year");
    await vi.waitFor(() =>
      expect(window.openbot.agent.getHostAnalytics).toHaveBeenLastCalledWith(analyticsRange("a", 365), "host-a"),
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
    let completeOld: (value: HostAnalytics) => void = () => {
      throw new Error("No pending request");
    };
    const pending = new Promise<HostAnalytics>((resolve) => {
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
      { ...emptyAnalyticsTotals(), estimatedCostUsd: 0.03, processedTokens: 350, date: data.startDate },
      { ...emptyAnalyticsTotals(), estimatedCostUsd: 0.02, processedTokens: 700, date: data.endDate },
    ];
    data.providerDaily = [
      { date: data.startDate, provider: "codex", processedTokens: 250, estimatedCostUsd: 0.01 },
      { date: data.startDate, provider: "claude", processedTokens: 100, estimatedCostUsd: 0.02 },
      { date: data.endDate, provider: "codex", processedTokens: 700, estimatedCostUsd: 0.02 },
    ];
    vi.mocked(window.openbot.agent.getHostAnalytics).mockResolvedValue(data);
    show();
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Partial data"));
    expect(within(screen.getByRole("region", { name: "Usage summary" })).getByText("$0.00000002")).toBeInTheDocument();
    const chartDate = new Date(`${data.endDate}T12:00:00Z`)
      .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
      .toUpperCase();
    expect(
      await within(screen.getByRole("img", { name: /Daily estimated/ })).findByText(chartDate),
    ).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /Daily estimated/ });
    await fireEvent.keyDown(chart, { key: "ArrowRight" });
    // The chart draws one area per provider, so the hover card names each provider's own
    // cost for the day and the Total below them is what the day's area used to say alone.
    const card = await screen.findByRole("tooltip");
    expect(card).toHaveTextContent("Codex");
    expect(card).toHaveTextContent("0.01 USD");
    expect(card).toHaveTextContent("Claude Code");
    expect(card).toHaveTextContent("0.02 USD");
    expect(card).toHaveTextContent("Total");
    expect(card).toHaveTextContent("0.03 USD");
    // The breakdown opens on the split by agent, and the hidden panels are inert, so this
    // names which table a user sees before touching a tab.
    expect(screen.getByRole("table", { name: "Usage by agent" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "View daily data" }));
    await vi.waitFor(() => expect(screen.getByRole("table", { name: "Daily usage and cost" })).toHaveFocus());
    await pick("Usage metric", "Tokens");
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
