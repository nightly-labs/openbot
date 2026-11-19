/**
 * The `openbot` CRM tools. An agent reads customers and payments and proposes changes; a person
 * approves each proposal on the CRM page. Only agents that an owner or admin let in get answers, and
 * private fields stay hidden (see `CrmAgentView`). Each text here goes into the agent's context, so
 * the schemas stay small and the change check is the contract's `isCrmProposedChange`.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { CRM_EVERY, CRM_LIMITS, CRM_METHODS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { CrmAgentOperations } from "../crm/crm-agent-view";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";

const id = z.string().min(1).max(INPUT_LIMITS.identifier);
const cursor = z.string().min(1).max(256).describe("next of the last page");
const limit = z.number().int().min(1).max(100).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD.");
const timestamp = z.string().min(1).max(64);
const amount = z.string().min(1).max(40);
const label = z.string().trim().min(1).max(CRM_LIMITS.label);
const text = z.string().max(CRM_LIMITS.text);
const method = z.enum(CRM_METHODS);
const every = z.enum(CRM_EVERY);
const currency = z.string().regex(/^[A-Za-z]{3}$/u, "Use an ISO 4217 code, such as EUR.");
const tags = z.array(z.string().trim().min(1).max(INPUT_LIMITS.identifier)).max(CRM_LIMITS.customerTags);

const customerFields = {
  name: z.string().trim().min(1).max(CRM_LIMITS.name).optional(),
  contactName: text.optional(),
  contactEmail: text.optional(),
  phone: text.optional(),
  billingEmail: text.optional(),
  domain: text.optional(),
  taxId: text.optional(),
  address: text.optional(),
  stripeCustomerId: text.optional(),
  notes: z.string().max(CRM_LIMITS.notes).optional(),
  status: z.string().trim().min(1).max(INPUT_LIMITS.identifier).optional(),
  ownerAgentId: id.nullable().optional(),
  method: method.nullable().optional(),
  currency: currency.optional(),
};

const changeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("customer-create"),
    customer: z.strictObject({
      ...customerFields,
      name: z.string().trim().min(1).max(CRM_LIMITS.name),
      currency,
      tags: tags.optional(),
    }),
  }),
  z.strictObject({ kind: z.literal("customer-update"), customerId: id, patch: z.strictObject(customerFields) }),
  z.strictObject({ kind: z.literal("customer-tags"), customerId: id, tags }),
  z.strictObject({
    kind: z.literal("plan-create"),
    plan: z.strictObject({ customerId: id, name: label, amount, every, startsOn: date }),
  }),
  z.strictObject({
    kind: z.literal("plan-update"),
    planId: id,
    patch: z.strictObject({ name: label.optional(), amount: amount.optional(), every: every.optional() }),
  }),
  z.strictObject({ kind: z.literal("plan-end"), planId: id, endsOn: date }),
  z.strictObject({
    kind: z.literal("payment-create"),
    payment: z.strictObject({
      customerId: id,
      label,
      amount,
      dueOn: date,
      method: method.nullable().optional(),
      paidAt: timestamp.nullable().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("payment-update"),
    paymentId: id,
    patch: z.strictObject({
      label: label.optional(),
      amount: amount.optional(),
      dueOn: date.optional(),
      method: method.nullable().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("payment-paid"),
    paymentIds: z.array(id).min(1).max(CRM_LIMITS.paymentIds),
    paidAt: timestamp.nullable().describe("null marks them not paid"),
  }),
  z.strictObject({
    kind: z.literal("payment-split"),
    paymentId: id,
    parts: z
      .array(z.strictObject({ amount, dueOn: date }))
      .min(2)
      .max(CRM_LIMITS.splitParts),
  }),
]);

const findSchema = z.strictObject({
  query: z.string().trim().min(1).max(200).optional().describe("text or customer number"),
  status: z.string().trim().min(1).max(INPUT_LIMITS.identifier).optional().describe("status id or label"),
  tag: z.string().trim().min(1).max(INPUT_LIMITS.identifier).optional().describe("tag id or label"),
  payment: z.enum(["late", "open", "paid-up"]).optional(),
  cursor: cursor.optional(),
  limit,
});
const customerSchema = z.strictObject({ customerId: id });
const paymentsSchema = z.strictObject({
  state: z.enum(["open", "late"]),
  customerId: id.optional(),
  cursor: cursor.optional(),
  limit,
});
const proposeSchema = z.strictObject({
  change: changeSchema,
  reason: z.string().trim().min(1).max(CRM_LIMITS.reason).describe("why, for the person who approves"),
});

export const CRM_TOOL_DEFINITIONS = [
  {
    name: "crm_find",
    description:
      "Find CRM customers by text, number, status, tag or payment state. Gives id, number, name, status, tags and money due. Private fields are hidden or left out.",
    shape: findSchema.shape,
  },
  {
    name: "crm_customer",
    description:
      "Read one CRM customer: fields, plans, open and recent payments, and recent activity. Amounts are decimal text with the currency.",
    shape: customerSchema.shape,
  },
  {
    name: "crm_payments",
    description: "List open or late CRM payments, soonest due first, for all customers or one.",
    shape: paymentsSchema.shape,
  },
  {
    name: "crm_propose",
    description:
      "Propose a CRM change: a new or changed customer, tags, a plan, or a payment. A person approves it first. Rows with a source are read-only.",
    shape: proposeSchema.shape,
  },
] as const;

export const CRM_TOOL_NAMES: ReadonlySet<string> = new Set(CRM_TOOL_DEFINITIONS.map((tool) => tool.name));

export const handleCrmTool = Effect.fn("CrmTools.handle")(function* (
  tool: string,
  args: unknown,
  crm: CrmAgentOperations | null,
  /** The agent that calls the tool. Its CRM access decides each answer. */
  agentId: string,
  /** The public thread of the call, which a proposal links to. */
  threadId: string | null,
  /** The tool-error redaction of the router. */
  redact: (text: string) => string,
) {
  if (!CRM_TOOL_NAMES.has(tool)) return null;
  if (!crm) return yield* new ToolOperationFailed({ cause: new Error("The CRM is unavailable.") });

  const operation = Effect.gen(function* () {
    if (tool === "crm_find") {
      const input = yield* toolStep(() => findSchema.parse(args ?? {}));
      return openBotToolResult(yield* crm.agentFind(agentId, input));
    }
    if (tool === "crm_customer") {
      const input = yield* toolStep(() => customerSchema.parse(args));
      return openBotToolResult(yield* crm.agentCustomer(agentId, input.customerId));
    }
    if (tool === "crm_payments") {
      const input = yield* toolStep(() => paymentsSchema.parse(args));
      return openBotToolResult(yield* crm.agentPayments(agentId, input));
    }
    const input = yield* toolStep(() => proposeSchema.parse(args));
    const { proposalId } = yield* crm.agentPropose(agentId, { ...input, threadId });
    return openBotToolResult({
      proposalId,
      status: "pending",
      next: "An owner or admin approves or rejects it on the CRM page. Do not propose it again.",
    });
  });

  return yield* operation.pipe(
    Effect.catchTag("CrmError", (failure) => Effect.succeed(openBotToolFailure(redact(failure.message)))),
  );
});
