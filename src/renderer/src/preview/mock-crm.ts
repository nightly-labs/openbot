// The CRM group of the preview, in memory, with the host's rules: the three built-in statuses, a
// revision check on a customer update, a first payment when a plan starts, the next payment when a
// recurring one is paid, and proposals that an approval applies. It starts empty unless a story
// gives a seed. Each change emits `crm-changed`.

import {
  CRM_BUILTIN_STATUS_IDS,
  CRM_LIMITS,
  CRM_TONES,
  type CrmActivity,
  type CrmActor,
  type CrmApplyResult,
  type CrmChange,
  type CrmCustomer,
  type CrmEvery,
  type CrmPayment,
  type CrmPlan,
  type CrmPrivateField,
  type CrmProposal,
  type CrmProposedChange,
  type CrmSource,
  type CrmStatus,
  type CrmTag,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";

/** A customer as a story gives it: the totals come from the payments. */
export type MockCrmCustomer = Omit<CrmCustomer, "paidMinor" | "openMinor" | "lateMinor" | "nextDueOn" | "lastPaidAt">;

export interface MockCrmSeed {
  /** Statuses after the built-in ones. */
  statuses?: CrmStatus[];
  tags?: CrmTag[];
  customers?: MockCrmCustomer[];
  payments?: CrmPayment[];
  proposals?: CrmProposal[];
  privateFields?: CrmPrivateField[];
  agentIds?: string[];
  sources?: CrmSource[];
  /** The Server Settings > Experimental switch. The preview shows the CRM unless a story turns it off. */
  enabled?: boolean;
}

const BUILTIN_TONES: Record<(typeof CRM_BUILTIN_STATUS_IDS)[number], CrmStatus["tone"]> = {
  lead: "info-light",
  customer: "secondary",
  former: "outline",
};

const MONTHS: Record<Exclude<CrmEvery, "once">, number> = { month: 1, quarter: 3, year: 12 };

/** `date` moved by whole months; a day that the month does not have becomes its last day. */
function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

/** The CRM error keys that take no values. */
type CrmErrorKey = Exclude<Extract<keyof SourceMessages, `error.crm.${string}`>, "error.crm.amountDecimals">;

/** The host's error text. `missing` is true for an item that is gone, as the host's code `missing`. */
class MockCrmError extends Error {
  constructor(
    key: CrmErrorKey,
    readonly missing = key.endsWith("Missing"),
  ) {
    super(sourceText(key));
  }
}

function fail(key: CrmErrorKey): never {
  throw new MockCrmError(key);
}

export function mockCrm(seed: MockCrmSeed, emit: () => void): OpenBotDesktopApi["crm"] {
  const statuses: CrmStatus[] = [
    ...CRM_BUILTIN_STATUS_IDS.map((id) => ({ id, label: null, tone: BUILTIN_TONES[id] })),
    ...structuredClone(seed.statuses ?? []),
  ];
  let tags: CrmTag[] = structuredClone(seed.tags ?? []);
  const customers = new Map<string, MockCrmCustomer>(
    structuredClone(seed.customers ?? []).map((customer) => [customer.id, customer]),
  );
  const payments = new Map<string, CrmPayment>(
    structuredClone(seed.payments ?? []).map((payment) => [payment.id, payment]),
  );
  let proposals: CrmProposal[] = structuredClone(seed.proposals ?? []);
  let privateFields: CrmPrivateField[] = [...(seed.privateFields ?? [])];
  let agentIds: string[] = [...(seed.agentIds ?? [])];
  let sources: CrmSource[] = structuredClone(seed.sources ?? []);
  let enabled = seed.enabled ?? true;
  const activity: CrmActivity[] = [];
  let customerNumber = Math.max(0, ...[...customers.values()].map((customer) => customer.number));
  let invoiceNumber = Math.max(0, ...[...payments.values()].map((payment) => payment.number));

  const customer = (id: string) => customers.get(id) ?? fail("error.crm.customerMissing");
  const payment = (id: string) => payments.get(id) ?? fail("error.crm.paymentMissing");
  const plan = (id: string): CrmPlan =>
    [...customers.values()].flatMap((entry) => entry.plans).find((entry) => entry.id === id) ??
    fail("error.crm.planMissing");
  const status = (id: string) => statuses.find((entry) => entry.id === id) ?? fail("error.crm.statusMissing");
  const tagIds = (ids: string[]) => {
    for (const id of ids) if (!tags.some((tag) => tag.id === id)) fail("error.crm.tagMissing");
    return [...ids];
  };
  /** A status that a person made; the built-in ones cannot change. */
  /** As on the host: a row that a source owns is read-only. */
  const editable = <T extends { source: CrmSource["kind"] | null }>(row: T): T =>
    row.source === null ? row : fail("error.crm.sourceOwned");
  const customStatus = (id: string) =>
    CRM_BUILTIN_STATUS_IDS.some((builtin) => builtin === id) ? fail("error.crm.builtinStatus") : status(id);

  function touch(entry: MockCrmCustomer): void {
    entry.revision += 1;
    entry.updatedAt = new Date().toISOString();
  }

  function log(customerId: string, actor: CrmActor, kind: string, proposedBy: string | null): void {
    activity.unshift({
      id: crypto.randomUUID(),
      customerId,
      actor: structuredClone(actor),
      kind,
      details: {},
      proposedBy,
      createdAt: new Date().toISOString(),
    });
  }

  function addPayment(entry: Omit<CrmPayment, "id" | "number" | "currency" | "source">): string {
    const id = crypto.randomUUID();
    invoiceNumber += 1;
    payments.set(id, {
      ...entry,
      id,
      number: invoiceNumber,
      currency: customer(entry.customerId).currency,
      source: null,
    });
    return id;
  }

  /**
   * As the host does: the next payment of a recurring plan, while the plan has no open payment and has
   * not ended. The due date is the first period after the plan's last payment, counted from its start.
   */
  function nextPayment(paid: CrmPayment): void {
    if (paid.planId === null) return;
    const entry = plan(paid.planId);
    if (entry.every === "once" || entry.source !== null) return;
    const own = [...payments.values()].filter((other) => other.planId === entry.id);
    if (own.some((other) => other.paidAt === null)) return;
    const last =
      own
        .map((other) => other.dueOn)
        .sort()
        .at(-1) ?? null;
    let dueOn = addMonths(entry.startsOn, MONTHS[entry.every]);
    for (let step = 2; last !== null && dueOn <= last; step += 1)
      dueOn = addMonths(entry.startsOn, step * MONTHS[entry.every]);
    if (entry.endsOn !== null && dueOn > entry.endsOn) return;
    addPayment({
      customerId: paid.customerId,
      planId: entry.id,
      label: entry.name,
      amountMinor: entry.amountMinor,
      dueOn,
      paidAt: null,
      method: paid.method ?? customer(paid.customerId).method,
    });
  }

  function view(entry: MockCrmCustomer): CrmCustomer {
    const own = [...payments.values()].filter((item) => item.customerId === entry.id);
    const open = own.filter((item) => item.paidAt === null);
    const sum = (items: CrmPayment[]) => items.reduce((total, item) => total + item.amountMinor, 0);
    const paidAt = own.flatMap((item) => (item.paidAt === null ? [] : [item.paidAt])).sort();
    return {
      ...structuredClone(entry),
      paidMinor: sum(own.filter((item) => item.paidAt !== null)),
      openMinor: sum(open),
      lateMinor: sum(open.filter((item) => item.dueOn < today())),
      nextDueOn: open.map((item) => item.dueOn).sort()[0] ?? null,
      lastPaidAt: paidAt.at(-1) ?? null,
    };
  }

  /** One change, as the host applies it. `proposedBy` names the agent of an approved proposal. */
  function apply(change: CrmChange | CrmProposedChange, actor: CrmActor, proposedBy: string | null): CrmApplyResult {
    switch (change.kind) {
      case "customer-create": {
        const input = change.customer;
        status(input.statusId ?? "lead");
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        customerNumber += 1;
        customers.set(id, {
          name: input.name,
          contactName: input.contactName ?? "",
          contactEmail: input.contactEmail ?? "",
          phone: input.phone ?? "",
          billingEmail: input.billingEmail ?? "",
          domain: input.domain ?? "",
          taxId: input.taxId ?? "",
          address: input.address ?? "",
          stripeCustomerId: input.stripeCustomerId ?? "",
          notes: input.notes ?? "",
          id,
          number: customerNumber,
          statusId: input.statusId ?? "lead",
          ownerAgentId: input.ownerAgentId ?? null,
          method: input.method ?? null,
          currency: input.currency,
          tagIds: tagIds(input.tagIds ?? []),
          plans: [],
          source: null,
          createdAt: now,
          updatedAt: now,
          revision: 1,
        });
        log(id, actor, change.kind, proposedBy);
        return { ok: true, id };
      }
      case "customer-update": {
        const entry = customer(change.customerId);
        if ("baseRevision" in change && change.baseRevision !== entry.revision)
          return { ok: false, conflict: "revision" };
        if (change.patch.statusId !== undefined) status(change.patch.statusId);
        if (
          entry.source !== null &&
          change.patch.stripeCustomerId !== undefined &&
          change.patch.stripeCustomerId !== entry.stripeCustomerId
        )
          fail("error.crm.sourceOwned");
        // Plans and payments keep minor units of the customer's currency.
        const used = entry.plans.length > 0 || [...payments.values()].some((item) => item.customerId === entry.id);
        if (change.patch.currency !== undefined && change.patch.currency !== entry.currency && used)
          fail("error.crm.currencyInUse");
        Object.assign(entry, change.patch);
        touch(entry);
        log(entry.id, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "customer-tags": {
        const entry = customer(change.customerId);
        entry.tagIds = tagIds(change.tagIds);
        touch(entry);
        log(entry.id, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "customer-delete": {
        customer(change.customerId);
        customers.delete(change.customerId);
        for (const item of [...payments.values()]) if (item.customerId === change.customerId) payments.delete(item.id);
        proposals = proposals.filter((item) => item.customerId !== change.customerId);
        return { ok: true, id: null };
      }
      case "plan-create": {
        const entry = customer(change.plan.customerId);
        if (entry.plans.length >= CRM_LIMITS.customerPlans) fail("error.crm.tooManyPlans");
        const id = crypto.randomUUID();
        entry.plans.push({ ...change.plan, id, endsOn: null, source: null });
        addPayment({
          customerId: entry.id,
          planId: id,
          label: change.plan.name,
          amountMinor: change.plan.amountMinor,
          dueOn: change.plan.startsOn,
          paidAt: null,
          method: entry.method,
        });
        touch(entry);
        log(entry.id, actor, change.kind, proposedBy);
        return { ok: true, id };
      }
      case "plan-update": {
        const entry = editable(plan(change.planId));
        Object.assign(entry, change.patch);
        if (change.patch.amountMinor !== undefined)
          for (const item of payments.values())
            if (item.planId === entry.id && item.paidAt === null) item.amountMinor = change.patch.amountMinor;
        touch(customer(entry.customerId));
        log(entry.customerId, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "plan-end": {
        const entry = editable(plan(change.planId));
        if (change.endsOn < entry.startsOn) fail("error.crm.planEndsBeforeStart");
        entry.endsOn = change.endsOn;
        for (const item of [...payments.values()])
          if (item.planId === entry.id && item.paidAt === null && item.dueOn > change.endsOn) payments.delete(item.id);
        touch(customer(entry.customerId));
        log(entry.customerId, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "plan-delete": {
        const entry = editable(plan(change.planId));
        const owner = customer(entry.customerId);
        owner.plans = owner.plans.filter((item) => item.id !== entry.id);
        for (const item of [...payments.values()]) {
          if (item.planId !== entry.id) continue;
          if (item.paidAt === null) payments.delete(item.id);
          else item.planId = null;
        }
        touch(owner);
        log(owner.id, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "payment-create": {
        const owner = customer(change.payment.customerId);
        const id = addPayment({
          customerId: owner.id,
          planId: null,
          label: change.payment.label,
          amountMinor: change.payment.amountMinor,
          dueOn: change.payment.dueOn,
          paidAt: change.payment.paidAt ?? null,
          method: change.payment.method ?? owner.method,
        });
        log(owner.id, actor, change.kind, proposedBy);
        return { ok: true, id };
      }
      case "payment-update": {
        const entry = editable(payment(change.paymentId));
        Object.assign(entry, change.patch);
        log(entry.customerId, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "payment-paid": {
        // A null `paidAt` marks the payments unpaid again.
        const paidAt = change.paidAt === null ? null : new Date(change.paidAt).toISOString();
        for (const entry of change.paymentIds.map(payment)) editable(entry);
        for (const entry of change.paymentIds.map(payment)) {
          if (entry.paidAt === paidAt) continue;
          const first = entry.paidAt === null;
          entry.paidAt = paidAt;
          if (first) nextPayment(entry);
          log(entry.customerId, actor, change.kind, proposedBy);
        }
        return { ok: true, id: null };
      }
      case "payment-split": {
        const entry = editable(payment(change.paymentId));
        if (entry.paidAt !== null) fail("error.crm.paymentPaid");
        if (change.parts.reduce((sum, part) => sum + part.amountMinor, 0) !== entry.amountMinor)
          fail("error.crm.splitTotal");
        const [first, ...rest] = change.parts;
        if (!first) fail("error.crm.invalidChange");
        // The first part keeps the invoice number; each other part gets a new one.
        Object.assign(entry, first);
        for (const part of rest) addPayment({ ...entry, ...part });
        log(entry.customerId, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "payment-delete": {
        const entry = editable(payment(change.paymentId));
        payments.delete(entry.id);
        log(entry.customerId, actor, change.kind, proposedBy);
        return { ok: true, id: null };
      }
      case "tag-create": {
        if (tags.length >= CRM_LIMITS.tags) fail("error.crm.tooManyTags");
        if (tags.some((tag) => tag.label === change.label)) fail("error.crm.tagExists");
        const id = crypto.randomUUID();
        tags.push({ id, label: change.label });
        return { ok: true, id };
      }
      case "tag-delete": {
        if (!tags.some((tag) => tag.id === change.tagId)) fail("error.crm.tagMissing");
        tags = tags.filter((tag) => tag.id !== change.tagId);
        for (const entry of customers.values()) entry.tagIds = entry.tagIds.filter((id) => id !== change.tagId);
        return { ok: true, id: null };
      }
      case "status-create": {
        if (statuses.length >= CRM_LIMITS.statuses) fail("error.crm.tooManyStatuses");
        if (statuses.some((entry) => entry.label === change.label)) fail("error.crm.statusExists");
        const id = crypto.randomUUID();
        // A new status takes the next tone, as the host gives it.
        statuses.push({
          id,
          label: change.label,
          tone: CRM_TONES[statuses.length % CRM_TONES.length] ?? "secondary",
        });
        return { ok: true, id };
      }
      case "status-rename": {
        const entry = customStatus(change.statusId);
        if (statuses.some((other) => other.id !== entry.id && other.label === change.label))
          fail("error.crm.statusExists");
        entry.label = change.label;
        return { ok: true, id: null };
      }
      case "status-delete": {
        customStatus(change.statusId);
        status(change.replaceWith);
        statuses.splice(
          statuses.findIndex((entry) => entry.id === change.statusId),
          1,
        );
        for (const entry of customers.values())
          if (entry.statusId === change.statusId) {
            entry.statusId = change.replaceWith;
            touch(entry);
          }
        return { ok: true, id: null };
      }
      case "private-fields":
        privateFields = [...change.fields];
        return { ok: true, id: null };
      case "agent-access":
        agentIds = [...change.agentIds];
        return { ok: true, id: null };
      case "proposal-decide": {
        const proposal = proposals.find((entry) => entry.id === change.proposalId) ?? fail("error.crm.proposalMissing");
        if (!change.approve) {
          proposals = proposals.filter((entry) => entry.id !== proposal.id);
          return { ok: true, id: null };
        }
        try {
          const result = apply(proposal.change, actor, proposal.agentId);
          proposals = proposals.filter((entry) => entry.id !== proposal.id);
          return result;
        } catch (error) {
          // As on the host: a missing item ends the proposal; a refused change stays pending.
          if (error instanceof MockCrmError && error.missing)
            proposals = proposals.filter((entry) => entry.id !== proposal.id);
          throw error;
        }
      }
    }
  }

  /** The rows after `after`, at most one page, and the cursor of the next page. */
  function page<T>(rows: T[], after: string | undefined): { rows: T[]; next: string | null } {
    const start = after === undefined ? 0 : Number(after);
    const end = start + CRM_LIMITS.page;
    return { rows: structuredClone(rows.slice(start, end)), next: end < rows.length ? String(end) : null };
  }

  return {
    overview: async () => structuredClone({ statuses, tags, privateFields, agentIds, proposals, sources }),
    customers: async (input) => {
      const rows = [...customers.values()]
        .filter((entry) => input.after === undefined || entry.number > input.after)
        .sort((left, right) => left.number - right.number);
      const shown = rows.slice(0, CRM_LIMITS.page).map(view);
      return { customers: shown, next: rows.length > shown.length ? (shown.at(-1)?.number ?? null) : null };
    },
    payments: async (input) => {
      const rows = [...payments.values()]
        .filter((entry) => (input.state === "open") === (entry.paidAt === null))
        .filter((entry) => input.customerId === undefined || entry.customerId === input.customerId)
        .sort((left, right) =>
          input.state === "open"
            ? left.dueOn.localeCompare(right.dueOn)
            : (right.paidAt ?? "").localeCompare(left.paidAt ?? ""),
        );
      const result = page(rows, input.after);
      return { payments: result.rows, next: result.next };
    },
    activity: async (input) => {
      customer(input.customerId);
      const result = page(
        activity.filter((entry) => entry.customerId === input.customerId),
        input.after,
      );
      return { activity: result.rows, next: result.next };
    },
    apply: async (change) => {
      const result = apply(change, { kind: "person", id: null, name: null }, null);
      if (result.ok) emit();
      return result;
    },
    // The preview has no Stripe: a connect adds the source with nothing to import, and a sync only
    // moves its time.
    sourceConnect: async (input) => {
      if (!/^rk_(live|test)_[A-Za-z0-9]+$/u.test(input.key.trim()))
        fail(input.key.trim().startsWith("sk_") ? "error.crm.sourceSecretKey" : "error.crm.sourceInvalidKey");
      if (sources.some((entry) => entry.kind === input.kind)) fail("error.crm.sourceConnected");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sources.push({
        id,
        kind: input.kind,
        testMode: input.key.trim().startsWith("rk_test_"),
        accountLabel: "",
        keyHint: input.key.trim().slice(-4),
        state: "ok",
        errorCode: null,
        syncedAt: now,
        connectedAt: now,
        skipped: { currency: 0, interval: 0, limit: 0 },
      });
      emit();
      return { ok: true, id };
    },
    sourceDisconnect: async (input) => {
      const entry = sources.find((item) => item.id === input.sourceId) ?? fail("error.crm.sourceMissing");
      sources = sources.filter((item) => item.id !== entry.id);
      // The rows stay and become editable.
      for (const item of customers.values()) {
        item.source = null;
        for (const owned of item.plans) owned.source = null;
      }
      for (const item of payments.values()) item.source = null;
      emit();
      return { ok: true, id: null };
    },
    sourceSync: async (input) => {
      const entry = sources.find((item) => item.id === input.sourceId) ?? fail("error.crm.sourceMissing");
      entry.state = "ok";
      entry.errorCode = null;
      entry.syncedAt = new Date().toISOString();
      emit();
      return { ok: true, id: null };
    },
    settings: async () => ({ enabled }),
    setSettings: async (input) => {
      if (input.enabled !== enabled) {
        enabled = input.enabled;
        emit();
      }
      return { enabled };
    },
  };
}
