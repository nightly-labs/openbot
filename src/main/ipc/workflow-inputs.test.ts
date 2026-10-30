// @vitest-environment node

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { describe, expect, it } from "vitest";
import {
  parseCreateWorkflow,
  parseDecideWorkflowStep,
  parseRetryWorkflowStep,
  parseRunWorkflowStep,
  parseSaveWorkflowGraph,
  parseStartWorkflowRun,
  parseWorkflowRuns,
  parseWorkflowTrigger,
  parseWorkflowVersion,
} from "./workflow-inputs";

const node = (id: string, fields: object = {}) => ({ id, kind: "prompt", at: { x: 0, y: 0 }, fields });
const save = (graph: unknown) => ({ workflowId: "workflow-1", baseRevision: 0, graph });

describe("workflow payloads from the renderer", () => {
  it("keeps only the known fields of a valid save", () => {
    const graph = { nodes: [node("a", { text: "hi" })], edges: [], strokes: [] };
    expect(parseSaveWorkflowGraph({ ...save(graph), extra: "dropped" })).toEqual(save(graph));
  });

  it("keeps only the known keys inside nodes, edges, strokes and points", () => {
    const point = { x: 1, y: 2, pressure: 0.5 };
    const graph = {
      nodes: [
        { ...node("a"), at: point, size: { width: 10, depth: 3 }, owner: "x" },
        { ...node("b"), locked: true },
      ],
      edges: [{ id: "e", from: "a", to: "b", type: "text", weight: 2 }],
      strokes: [{ id: "s", brush: "pen", color: "ink", width: 2, points: [point], blur: 1 }],
      comments: [],
    };
    expect(parseSaveWorkflowGraph(save(graph)).graph).toEqual({
      nodes: [
        { ...node("a"), at: { x: 1, y: 2 }, size: { width: 10 } },
        { ...node("b"), locked: true },
      ],
      edges: [{ id: "e", from: "a", to: "b", type: "text" }],
      strokes: [{ id: "s", brush: "pen", color: "ink", width: 2, points: [{ x: 1, y: 2 }] }],
    });
  });

  it("refuses a graph whose JSON is over the byte limit, also on create", () => {
    const text = "x".repeat(INPUT_LIMITS.workflowNodeText);
    const count = Math.ceil(INPUT_LIMITS.workflowGraphBytes / text.length) + 1;
    const graph = {
      nodes: Array.from({ length: count }, (_, index) => node(`n${index}`, { text })),
      edges: [],
      strokes: [],
    };
    expect(() => parseSaveWorkflowGraph(save(graph))).toThrow("This workflow is too large to save.");
    expect(() => parseCreateWorkflow({ title: "Big", graph })).toThrow("This workflow is too large to save.");
  });

  it("keeps only the workflow and the version of a version request", () => {
    expect(parseWorkflowVersion({ workflowId: "w", versionId: "v", graph: {} })).toEqual({
      workflowId: "w",
      versionId: "v",
    });
    expect(() => parseWorkflowVersion({ workflowId: "w" })).toThrow("Invalid workflow version.");
  });

  it.each([
    ["an unknown node kind", { nodes: [{ ...node("a"), kind: "script" }], edges: [], strokes: [] }],
    [
      "an edge to a node that is not in the graph",
      {
        nodes: [node("a")],
        edges: [{ id: "e", from: "a", to: "b", type: "text" }],
        strokes: [],
      },
    ],
    ["a field that is an object", { nodes: [node("a", { text: { toString: "x" } })], edges: [], strokes: [] }],
    [
      "a schedule on a node that is not a trigger",
      {
        nodes: [{ ...node("a"), schedule: { kind: "daily", time: "09:00" } }],
        edges: [],
        strokes: [],
      },
    ],
    [
      "too many nodes",
      {
        nodes: Array.from({ length: INPUT_LIMITS.workflowNodes + 1 }, (_, index) => node(`n${index}`)),
        edges: [],
        strokes: [],
      },
    ],
    [
      "a field over the text limit",
      {
        nodes: [node("a", { text: "x".repeat(INPUT_LIMITS.workflowNodeText + 1) })],
        edges: [],
        strokes: [],
      },
    ],
    [
      "a coordinate that is not finite",
      { nodes: [{ ...node("a"), at: { x: Number.NaN, y: 0 } }], edges: [], strokes: [] },
    ],
  ])("refuses %s", (_name, graph) => {
    expect(() => parseSaveWorkflowGraph(save(graph))).toThrow("Invalid workflow graph.");
  });

  it("refuses a stale revision that is not a whole number, and a title over the limit", () => {
    expect(() =>
      parseSaveWorkflowGraph({ ...save({ nodes: [], edges: [], strokes: [] }), baseRevision: 1.5 }),
    ).toThrow();
    expect(() => parseCreateWorkflow({ title: "x".repeat(INPUT_LIMITS.workflowTitle + 1) })).toThrow(
      "Invalid workflow.",
    );
    expect(() => parseCreateWorkflow({ title: "   " })).toThrow("Invalid workflow.");
  });

  it("keeps only the known fields of the run requests", () => {
    expect(parseStartWorkflowRun({ workflowId: "w", requestId: "r", extra: 1 })).toEqual({
      workflowId: "w",
      requestId: "r",
    });
    expect(parseRunWorkflowStep({ workflowId: "w", nodeId: "n", requestId: "r", fromNodeId: "x" })).toEqual({
      workflowId: "w",
      nodeId: "n",
      requestId: "r",
    });
    expect(parseDecideWorkflowStep({ stepId: "s", approved: false, output: "x" })).toEqual({
      stepId: "s",
      approved: false,
    });
    expect(parseWorkflowTrigger({ workflowId: "w", nodeId: "n", secret: "whsec_x" })).toEqual({
      workflowId: "w",
      nodeId: "n",
    });
  });

  it.each([
    ["a run without a request id", () => parseStartWorkflowRun({ workflowId: "w" })],
    ["a start node that is not text", () => parseStartWorkflowRun({ workflowId: "w", requestId: "r", fromNodeId: 1 })],
    ["a retry without a step", () => parseRetryWorkflowStep({ requestId: "r" })],
    ["a decision that is not a boolean", () => parseDecideWorkflowStep({ stepId: "s", approved: "yes" })],
    [
      "a runs page over the limit",
      () => parseWorkflowRuns({ workflowId: "w", limit: INPUT_LIMITS.workflowRunsPage + 1 }),
    ],
    ["a runs page of zero", () => parseWorkflowRuns({ workflowId: "w", limit: 0 })],
    ["a runs cursor over the limit", () => parseWorkflowRuns({ workflowId: "w", limit: 1, before: "x".repeat(65) })],
    ["an empty runs cursor", () => parseWorkflowRuns({ workflowId: "w", limit: 1, before: "" })],
    ["a webhook secret request without a node", () => parseWorkflowTrigger({ workflowId: "w" })],
  ])("refuses %s", (_name, parse) => {
    expect(parse).toThrow();
  });
});
