import { describe, expect, it } from "vitest";
import { TEAM_CURRENT_CAPABILITIES } from "./current";
import { optionalTeamEvent } from "./optional-events";
import { optionalRouteCodec } from "./optional-routes";
import { ROUTINE_FLOWS_CAPABILITY, ROUTINE_FLOWS_ROUTES, routineFlowsEvent } from "./routine-flows-v1";

function codec(path: string) {
  const found = optionalRouteCodec(path);
  if (!found) throw new Error(`No codec for ${path}.`);
  return found;
}

const TIME = "2026-10-08T09:00:00.000Z";
const link = {
  id: "link-1",
  routineId: "routine-1",
  fromAgentId: "chief",
  toAgentId: "writer",
  instruction: "",
  createdAt: TIME,
};
const step = {
  id: "step-1",
  runId: "run-1",
  agentId: "chief",
  deliveryId: null,
  input: "Do it.",
  output: "Done.",
  status: "succeeded",
  error: null,
  createdAt: TIME,
  updatedAt: TIME,
};
const run = {
  id: "run-1",
  routineId: "routine-1",
  triggerId: null,
  kind: "manual",
  scheduledFor: TIME,
  routineName: "Daily",
  instruction: "Do it.",
  status: "succeeded",
  error: null,
  createdAt: TIME,
  updatedAt: TIME,
  agentId: "chief",
  deliveryId: "delivery-1",
};
const canvas = {
  agentId: "chief",
  routines: [
    {
      routine: {
        id: "routine-1",
        agentId: "chief",
        name: "Daily",
        instruction: "Do it.",
        active: true,
        timezone: "UTC",
        trigger: { kind: "webhook", url: null, eventType: null, filters: [] },
        limitPolicy: "wait",
        createdAt: TIME,
        updatedAt: TIME,
      },
      recentRuns: [run],
      upcomingRuns: [TIME],
      steps: [step],
    },
  ],
  links: [link],
  positions: [{ nodeKey: "agent:writer", x: -12.5, y: 40 }],
  placedAgentIds: ["writer"],
};

describe("routine-flows-v1", () => {
  it("is one current capability, inside the limit the frozen decoders accept", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(ROUTINE_FLOWS_CAPABILITY);
    expect(TEAM_CURRENT_CAPABILITIES.length).toBeLessThanOrEqual(64);
    expect(optionalRouteCodec(`${ROUTINE_FLOWS_ROUTES.canvas}?x=1`)).toBeDefined();
    expect(optionalRouteCodec("/v1/routine-flows")).toBeUndefined();
  });

  it("round-trips every route", () => {
    expect(codec(ROUTINE_FLOWS_ROUTES.canvas).request({ agentId: "chief" })).toEqual({ agentId: "chief" });
    expect(codec(ROUTINE_FLOWS_ROUTES.canvas).response(200, canvas)).toEqual(canvas);
    const position = { agentId: "chief", nodeKey: "routine:routine-1", x: 1, y: 2 };
    expect(codec(ROUTINE_FLOWS_ROUTES.savePosition).request(position)).toEqual(position);
    expect(codec(ROUTINE_FLOWS_ROUTES.savePosition).response(200, {})).toEqual({});
    expect(codec(ROUTINE_FLOWS_ROUTES.removePosition).request({ agentId: "chief", nodeKey: "agent:a" })).toEqual({
      agentId: "chief",
      nodeKey: "agent:a",
    });
    const connect = { routineId: "routine-1", fromAgentId: "chief", toAgentId: "writer" };
    expect(codec(ROUTINE_FLOWS_ROUTES.connect).request(connect)).toEqual(connect);
    expect(codec(ROUTINE_FLOWS_ROUTES.connect).request({ ...connect, instruction: "Edit." })).toEqual({
      ...connect,
      instruction: "Edit.",
    });
    expect(codec(ROUTINE_FLOWS_ROUTES.connect).response(200, link)).toEqual(link);
    expect(codec(ROUTINE_FLOWS_ROUTES.disconnect).request({ linkId: "link-1" })).toEqual({ linkId: "link-1" });
    expect(codec(ROUTINE_FLOWS_ROUTES.updateLink).request({ linkId: "link-1", instruction: "" })).toEqual({
      linkId: "link-1",
      instruction: "",
    });
    expect(codec(ROUTINE_FLOWS_ROUTES.updateLink).response(400, { error: "No." })).toEqual({ error: "No." });
  });

  it("drops fields the contract does not name, such as a webhook secret", () => {
    const [flow] = canvas.routines;
    if (!flow) throw new Error("Missing routine fixture.");
    const leaky = {
      ...canvas,
      extra: true,
      routines: [{ ...flow, routine: { ...flow.routine, trigger: { ...flow.routine.trigger, secret: "s3cret" } } }],
    };
    expect(JSON.stringify(codec(ROUTINE_FLOWS_ROUTES.canvas).response(200, leaky))).not.toContain("s3cret");
    expect(codec(ROUTINE_FLOWS_ROUTES.canvas).response(200, leaky)).toEqual(canvas);
  });

  it("rejects malformed payloads", () => {
    const save = codec(ROUTINE_FLOWS_ROUTES.savePosition).request;
    expect(() => save({ agentId: "chief", nodeKey: "chief", x: 0, y: 0 })).toThrow();
    expect(() => save({ agentId: "chief", nodeKey: "agent:a:b", x: 0, y: 0 })).toThrow();
    expect(() => save({ agentId: "chief", nodeKey: "agent:a", x: 1_000_001, y: 0 })).toThrow();
    expect(() => save({ agentId: "chief", nodeKey: "agent:a", x: Number.NaN, y: 0 })).toThrow();
    expect(() =>
      codec(ROUTINE_FLOWS_ROUTES.updateLink).request({ linkId: "link-1", instruction: "x".repeat(100_001) }),
    ).toThrow();
    const respond = (value: unknown) => codec(ROUTINE_FLOWS_ROUTES.canvas).response(200, value);
    const [flow] = canvas.routines;
    if (!flow) throw new Error("Missing routine fixture.");
    expect(() =>
      respond({ ...canvas, routines: [{ ...flow, steps: [{ ...step, input: "x".repeat(4_001) }] }] }),
    ).toThrow();
    expect(() =>
      respond({ ...canvas, routines: [{ ...flow, routine: { ...flow.routine, trigger: { kind: "email" } } }] }),
    ).toThrow();
    expect(() => respond({ ...canvas, links: [{ ...link, id: "" }] })).toThrow();
  });

  it("keeps only the agent of a change event and fails closed on a malformed one", () => {
    expect(optionalTeamEvent({ type: "routine-flows-changed", agentId: "chief", links: [] })).toEqual({
      type: "routine-flows-changed",
      agentId: "chief",
    });
    expect(() => routineFlowsEvent({ type: "routine-flows-changed" })).toThrow();
    expect(() => routineFlowsEvent({ type: "routine-flows-changed", agentId: "a".repeat(129) })).toThrow();
    expect(routineFlowsEvent({ type: "routines-changed", agentId: "chief" })).toBeNull();
  });
});
