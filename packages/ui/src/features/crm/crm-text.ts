import type {
  CrmActivity,
  CrmCustomerPatch,
  CrmEvery,
  CrmMethod,
  CrmPayment,
  CrmPlan,
  CrmProposal,
  CrmProposedChange,
  CrmSourceKind,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { CalendarClock, CircleCheck, Pencil, Repeat, Split, Tag, UserRoundPlus, type UsersRound } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import {
  daysBetween,
  daysLate,
  detailText,
  EVERY_KEY,
  FIELD_KEY,
  formatDay,
  formatMoney,
  localDateOf,
  METHOD_KEY,
  PRICE_KEY,
  SOURCE_KEY,
  statusLabel,
} from "./crm-model";
import type { CrmViewModel } from "./crm-state";

export const PROPOSAL_ICON: Record<CrmProposedChange["kind"], typeof UsersRound> = {
  "customer-create": UserRoundPlus,
  "customer-update": Pencil,
  "customer-tags": Tag,
  "plan-create": Repeat,
  "plan-update": Repeat,
  "plan-end": Repeat,
  "payment-create": CalendarClock,
  "payment-update": CalendarClock,
  "payment-paid": CircleCheck,
  "payment-split": Split,
};

const PATCH_FIELD_KEY: Record<keyof CrmCustomerPatch, AppTextKey> = {
  ...FIELD_KEY,
  statusId: "crm.field.status",
  ownerAgentId: "crm.field.owner",
  method: "crm.field.method",
  currency: "crm.field.currency",
};

const PLAN_FIELD_KEY: Record<string, AppTextKey> = {
  name: "crm.planField.name",
  amountMinor: "crm.planField.amount",
  every: "crm.planField.every",
};

const PAYMENT_FIELD_KEY: Record<string, AppTextKey> = {
  label: "crm.paymentField.label",
  amountMinor: "crm.paymentField.amount",
  dueOn: "crm.paymentField.dueOn",
  method: "crm.paymentField.method",
  paidAt: "crm.paymentField.paidAt",
};

function isMethod(value: string): value is CrmMethod {
  return Object.hasOwn(METHOD_KEY, value);
}

function isSourceKind(value: string | null): value is CrmSourceKind {
  return value !== null && Object.hasOwn(SOURCE_KEY, value);
}

function isEvery(value: string): value is CrmEvery {
  return Object.hasOwn(EVERY_KEY, value);
}

function fieldKey(keys: Record<string, AppTextKey>, field: string): AppTextKey | undefined {
  return Object.hasOwn(keys, field) ? keys[field] : undefined;
}

function isPatchField(value: string): value is keyof CrmCustomerPatch {
  return Object.hasOwn(PATCH_FIELD_KEY, value);
}

export function useCrmText(crm: CrmViewModel) {
  const { t, format } = useText();

  const money = (minor: number, currency: string | undefined) =>
    currency ? formatMoney(format, minor, currency) : format.number(minor);
  const invoice = (number: number | string) => t("crm.payment.invoice", { number });
  const customerName = (id: string | null | undefined) => crm.customer(id)?.name ?? t("crm.proposal.someCustomer");
  const price = (plan: Pick<CrmPlan, "amountMinor" | "every">, currency: string | undefined) =>
    t(PRICE_KEY[plan.every], { amount: money(plan.amountMinor, currency) });
  const method = (value: CrmMethod | null) => (value === null ? t("crm.method.none") : t(METHOD_KEY[value]));
  const plan = (planId: string) => {
    for (const customer of crm.customers()) {
      const found = customer.plans.find((item) => item.id === planId);
      if (found) return { plan: found, customer };
    }
    return undefined;
  };

  const due = (dueOn: string) => {
    const days = daysBetween(crm.today(), dueOn);
    if (days < 0) return t("crm.due.late", { count: -days });
    if (days === 0) return t("crm.due.today");
    if (days === 1) return t("crm.due.tomorrow");
    return t("crm.due.inDays", { count: days });
  };

  const timing = (payment: CrmPayment) => {
    const late = daysLate(payment, crm.today());
    return late === 0 ? t("crm.timing.onTime") : t("crm.due.late", { count: late });
  };

  const patchText = (customerId: string, patch: CrmCustomerPatch) => {
    const customer = customerName(customerId);
    const fields = Object.keys(patch).filter(isPatchField);
    if (fields.length === 1 && patch.statusId !== undefined)
      return t("crm.proposal.status", { customer, status: crm.statusText(patch.statusId) });
    if (fields.length === 1 && patch.ownerAgentId !== undefined)
      return t("crm.proposal.owner", { customer, owner: crm.agentName(patch.ownerAgentId) });
    return t("crm.proposal.customerUpdate", {
      customer,
      fields: format.list(fields.map((field) => t(PATCH_FIELD_KEY[field]))),
    });
  };

  const proposal = (item: CrmProposal): string => {
    const change = item.change;
    switch (change.kind) {
      case "customer-create":
        return t("crm.proposal.customerCreate", { name: change.customer.name });
      case "customer-update":
        return patchText(change.customerId, change.patch);
      case "customer-tags": {
        const tags = crm.tagLabels(change.tagIds);
        const customer = customerName(change.customerId);
        return tags.length === 0
          ? t("crm.proposal.tagsCleared", { customer })
          : t("crm.proposal.tags", { customer, tags: format.list(tags) });
      }
      case "plan-create":
        return t("crm.proposal.planCreate", {
          plan: change.plan.name,
          price: price(change.plan, crm.customer(change.plan.customerId)?.currency),
          customer: customerName(change.plan.customerId),
        });
      case "plan-update": {
        const found = plan(change.planId);
        const name = found?.plan.name ?? change.patch.name ?? "";
        const customer = customerName(found?.customer.id ?? item.customerId);
        if (change.patch.amountMinor !== undefined && found) {
          return t("crm.proposal.planPrice", {
            plan: name,
            customer,
            price: price(
              { amountMinor: change.patch.amountMinor, every: change.patch.every ?? found.plan.every },
              found.customer.currency,
            ),
          });
        }
        return t("crm.proposal.planUpdate", { plan: name, customer });
      }
      case "plan-end": {
        const found = plan(change.planId);
        return t("crm.proposal.planEnd", {
          plan: found?.plan.name ?? "",
          customer: customerName(found?.customer.id ?? item.customerId),
          date: formatDay(format, change.endsOn),
        });
      }
      case "payment-create": {
        const input = change.payment;
        const amount = money(input.amountMinor, crm.customer(input.customerId)?.currency);
        const customer = customerName(input.customerId);
        return input.paidAt
          ? t("crm.proposal.paymentRecord", { amount, customer })
          : t("crm.proposal.paymentCreate", { amount, customer, date: formatDay(format, input.dueOn) });
      }
      case "payment-update": {
        const payment = crm.payment(change.paymentId);
        if (!payment) return t("crm.proposal.paymentUpdateOther", { customer: customerName(item.customerId) });
        const customer = customerName(payment.customerId);
        const fields = Object.keys(change.patch);
        if (fields.length === 1 && change.patch.dueOn !== undefined)
          return t("crm.proposal.paymentMove", {
            invoice: invoice(payment.number),
            customer,
            date: formatDay(format, change.patch.dueOn),
          });
        return t("crm.proposal.paymentUpdate", { invoice: invoice(payment.number), customer });
      }
      case "payment-paid": {
        const [only] = change.paymentIds;
        const payment = change.paymentIds.length === 1 && only ? crm.payment(only) : undefined;
        if (change.paidAt === null) return t("crm.proposal.paymentUnpaid", { count: change.paymentIds.length });
        if (payment)
          return t("crm.proposal.paymentPaidOne", {
            invoice: invoice(payment.number),
            customer: customerName(payment.customerId),
          });
        return t("crm.proposal.paymentPaid", { count: change.paymentIds.length });
      }
      case "payment-split": {
        const payment = crm.payment(change.paymentId);
        return t("crm.proposal.paymentSplit", {
          count: change.parts.length,
          invoice: payment ? invoice(payment.number) : t("crm.proposal.somePayment"),
        });
      }
    }
  };

  const actor = (entry: CrmActivity) => {
    if (entry.actor.kind === "agent")
      return crm.agent(entry.actor.id)?.name ?? entry.actor.name ?? t("crm.actor.agent");
    if (entry.actor.kind === "source")
      return isSourceKind(entry.actor.id) ? t(SOURCE_KEY[entry.actor.id]) : (entry.actor.id ?? "");
    return entry.actor.name ?? t("crm.actor.owner");
  };

  const fieldValue = (field: string, value: string, currency: string | undefined) => {
    if (field === "ownerAgentId") return crm.agentName(value === "" ? null : value);
    if (field === "method") return isMethod(value) ? t(METHOD_KEY[value]) : t("crm.method.none");
    if (field === "amountMinor") return money(Number(value), currency);
    if (field === "dueOn" || field === "endsOn" || field === "startsOn") return formatDay(format, value);
    if (field === "paidAt") return value === "" ? "" : formatDay(format, localDateOf(value));
    if (field === "every") return isEvery(value) ? t(EVERY_KEY[value]) : value;
    return value;
  };

  const fieldLabel = (keys: Record<string, AppTextKey>, field: string) => {
    const key = fieldKey(keys, field);
    return key ? t(key) : field;
  };

  const activity = (entry: CrmActivity): string => {
    const name = actor(entry);
    const text = (key: string) => detailText(entry, key);
    const currency = text("currency") || crm.customer(entry.customerId)?.currency;
    const amount = () => money(Number(text("amountMinor")), currency);
    switch (entry.kind) {
      case "customer-created":
        return t("crm.activity.customerCreated", { actor: name });
      case "field-changed": {
        const field = text("field");
        const label = isPatchField(field) ? t(PATCH_FIELD_KEY[field]) : field;
        const to = text("to");
        if (field === "notes") return t("crm.activity.fieldChanged", { actor: name, field: label });
        if (to === "" && field !== "ownerAgentId" && field !== "method")
          return t("crm.activity.fieldCleared", { actor: name, field: label });
        return t("crm.activity.fieldSet", { actor: name, field: label, value: fieldValue(field, to, currency) });
      }
      case "status-changed":
        return t("crm.activity.statusChanged", {
          actor: name,
          from: text("fromLabel") || statusLabel(t, crm.status(text("from")), text("from")),
          to: text("toLabel") || statusLabel(t, crm.status(text("to")), text("to")),
        });
      case "tags-changed": {
        const added = text("added");
        const removed = text("removed");
        if (added && removed) return t("crm.activity.tagsChanged", { actor: name, added, removed });
        if (added) return t("crm.activity.tagsAdded", { actor: name, tags: added });
        return t("crm.activity.tagsRemoved", { actor: name, tags: removed });
      }
      case "plan-created": {
        const every = text("every");
        return t("crm.activity.planCreated", {
          actor: name,
          plan: text("plan"),
          price: isEvery(every) ? price({ amountMinor: Number(text("amountMinor")), every }, currency) : amount(),
        });
      }
      case "plan-changed": {
        const field = text("field");
        return t("crm.activity.planChanged", {
          actor: name,
          plan: text("plan"),
          field: fieldLabel(PLAN_FIELD_KEY, field),
          from: fieldValue(field, text("from"), currency),
          to: fieldValue(field, text("to"), currency),
        });
      }
      case "plan-ended":
        return t("crm.activity.planEnded", {
          actor: name,
          plan: text("plan"),
          date: formatDay(format, text("endsOn")),
        });
      case "plan-deleted":
        return t("crm.activity.planDeleted", { actor: name, plan: text("plan") });
      case "payment-created":
        return text("paidAt")
          ? t("crm.activity.paymentRecorded", { actor: name, invoice: invoice(text("number")), amount: amount() })
          : t("crm.activity.paymentCreated", {
              actor: name,
              invoice: invoice(text("number")),
              amount: amount(),
              date: formatDay(format, text("dueOn")),
            });
      case "payment-changed": {
        const field = text("field");
        return t("crm.activity.paymentChanged", {
          actor: name,
          invoice: invoice(text("number")),
          field: fieldLabel(PAYMENT_FIELD_KEY, field),
          from: fieldValue(field, text("from"), currency),
          to: fieldValue(field, text("to"), currency),
        });
      }
      case "payment-paid":
        return t("crm.activity.paymentPaid", { actor: name, invoice: invoice(text("number")), amount: amount() });
      case "payment-unpaid":
        return t("crm.activity.paymentUnpaid", { actor: name, invoice: invoice(text("number")) });
      case "payment-split":
        return t("crm.activity.paymentSplit", {
          actor: name,
          invoice: invoice(text("number")),
          count: Number(text("parts")) || 2,
        });
      case "payment-deleted":
        return t("crm.activity.paymentDeleted", { actor: name, invoice: invoice(text("number")), amount: amount() });
      case "proposal-rejected":
        return t("crm.activity.proposalRejected", { actor: name });
      case "customer-linked":
        return t("crm.activity.customerLinked", { actor: name, id: text("id") });
      default:
        return t("crm.activity.unknown", { actor: name });
    }
  };

  return { money, invoice, customerName, price, method, due, timing, proposal, actor, activity };
}
