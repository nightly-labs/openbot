import type {
  CrmActivity,
  CrmApplyResult,
  CrmChange,
  CrmCustomer,
  CrmCustomerPatch,
  CrmOverview,
  CrmPayment,
  CrmPrivateField,
  CrmProposal,
  CrmSource,
  CrmSourceKind,
  CrmStatus,
  CrmTag,
} from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore } from "solid-js";
import { type CrmAgent, type CrmLayout, readCrmLayout, statusLabel, todayIso } from "./crm-model";

/** What the host gave the page. The lists are complete: the page loads every page of them. */
export interface CrmData {
  overview: CrmOverview | null;
  customers: readonly CrmCustomer[];
  /** The payments that are not paid, of all customers. */
  open: readonly CrmPayment[];
  /** The paid payments of all customers. Empty until `paidLoaded`. */
  paid: readonly CrmPayment[];
  paidLoaded: boolean;
}

/** What the drawer reads for the open customer. null while it loads. */
export interface CrmDrawerData {
  customerId: string;
  activity: readonly CrmActivity[] | null;
  paid: readonly CrmPayment[] | null;
}

/**
 * Sends one change to the host. It gives the result, or null when the change failed. The caller
 * shows the failure and reads the CRM again.
 */
export type CrmApply = (change: CrmChange) => Promise<CrmApplyResult | null>;

/**
 * The connected payment sources. Each action gives true when the host took it; the caller shows
 * a failure and reads the CRM again. A sync runs on the host: the CRM changes when it ends.
 */
export interface CrmSourceActions {
  connect(kind: CrmSourceKind, key: string): Promise<boolean>;
  disconnect(sourceId: string): Promise<boolean>;
  sync(sourceId: string): Promise<boolean>;
  /** Opens the page of the source that makes a read-only key, in the browser. */
  openKeyPage(kind: CrmSourceKind): void;
}

export type CrmForm =
  | { kind: "customer" }
  /** The connectors: their list, or the page of one connector when `source` is set. */
  | { kind: "source"; source: CrmSourceKind | null }
  | { kind: "payment"; customerId: string | null; paymentId?: string }
  | { kind: "plan"; customerId: string; planId?: string }
  | { kind: "split"; paymentId: string };

/** A request of the host to open the connectors, such as from the rail menu. The page takes it once. */
export interface CrmConnectorsRequest {
  requested: () => boolean;
  taken: () => void;
}

export interface CrmViewProps {
  data: CrmData;
  agents: readonly CrmAgent[];
  /** The customer that the drawer shows. */
  selected: string | null;
  drawer: CrmDrawerData | null;
  /** The layout when the page opens. The page tells each change through `onLayoutChange`. */
  initialLayout: CrmLayout;
  onLayoutChange: (layout: CrmLayout) => void;
  apply: CrmApply;
  sources: CrmSourceActions;
  /** Loads the paid payments of all customers, for the payment history and the paid totals. */
  onLoadPaid: () => void;
  onSelect: (customerId: string | null) => void;
  connectors?: CrmConnectorsRequest | undefined;
}

interface ViewState {
  query: string;
  agents: boolean;
  form: CrmForm | null;
  /** The payments that the user picked in the payment sheet. */
  picked: string[];
}

/** The state and the actions of the CRM page, for its parts. */
export function createCrmView(props: CrmViewProps) {
  const { t } = useText();
  const [layout, setLayout] = createStore<CrmLayout>(readCrmLayout(props.initialLayout));
  const [view, setView] = createStore<ViewState>({ query: "", agents: false, form: null, picked: [] });

  createEffect(
    () => ({ saved: JSON.stringify(layout), save: props.onLayoutChange }),
    ({ saved, save }) => save(readCrmLayout(JSON.parse(saved))),
    { defer: true },
  );

  // A new read of the host can start a new day, so today follows the data.
  const today = createMemo(() => {
    void props.data.customers;
    return todayIso();
  });
  const overview = () => props.data.overview;
  const customers = createMemo(() => new Map(props.data.customers.map((customer) => [customer.id, customer])));
  const statuses = createMemo(() => new Map((overview()?.statuses ?? []).map((status) => [status.id, status])));
  const tags = createMemo(() => new Map((overview()?.tags ?? []).map((tag) => [tag.id, tag])));
  const agents = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const payments = createMemo(() => [...props.data.open, ...props.data.paid]);
  const privateFields = () => overview()?.privateFields ?? [];
  const access = () => overview()?.agentIds ?? [];

  const apply = (change: CrmChange) => props.apply(change);

  const crm = {
    layout,
    setLayout,
    view,
    setView,
    today,
    data: () => props.data,
    agents: () => props.agents,
    selected: () => props.selected,
    drawer: () => (props.drawer && props.drawer.customerId === props.selected ? props.drawer : null),
    customers: () => props.data.customers,
    payments,
    statuses: () => overview()?.statuses ?? [],
    tags: () => overview()?.tags ?? [],
    proposals: () => overview()?.proposals ?? [],
    /** The connected source of `kind`, or undefined. */
    source: (kind: CrmSourceKind): CrmSource | undefined => overview()?.sources.find((source) => source.kind === kind),
    sourceActions: () => props.sources,
    access,
    customer: (id: string | null | undefined): CrmCustomer | undefined =>
      id === null || id === undefined ? undefined : customers().get(id),
    status: (id: string): CrmStatus | undefined => statuses().get(id),
    statusText: (id: string) => statusLabel(t, statuses().get(id), id),
    tag: (id: string): CrmTag | undefined => tags().get(id),
    tagLabels: (ids: readonly string[]) => ids.flatMap((id) => tags().get(id)?.label ?? []),
    agent: (id: string | null | undefined): CrmAgent | undefined =>
      id === null || id === undefined ? undefined : agents().get(id),
    agentName: (id: string | null | undefined) =>
      id === null || id === undefined ? t("crm.owner.none") : (agents().get(id)?.name ?? t("crm.owner.unknown")),
    /** The payments of one customer: the open ones, and the paid ones when they are loaded. */
    paymentsOf: (customerId: string): CrmPayment[] => {
      const open = props.data.open.filter((payment) => payment.customerId === customerId);
      const drawer = props.drawer?.customerId === customerId ? props.drawer.paid : null;
      const paid = drawer ?? props.data.paid.filter((payment) => payment.customerId === customerId);
      return [...open, ...paid];
    },
    payment: (id: string): CrmPayment | undefined =>
      payments().find((payment) => payment.id === id) ?? props.drawer?.paid?.find((payment) => payment.id === id),
    isPrivate: (field: CrmPrivateField) => privateFields().includes(field),

    select(customerId: string | null) {
      setView((draft) => {
        draft.agents = false;
      });
      props.onSelect(customerId);
    },
    toggleAgents() {
      const open = !view.agents;
      setView((draft) => {
        draft.agents = open;
      });
      if (open) props.onSelect(null);
    },
    closePanel() {
      setView((draft) => {
        draft.agents = false;
      });
      props.onSelect(null);
    },
    openForm(form: CrmForm) {
      setView((draft) => {
        draft.form = form;
      });
    },
    closeForm() {
      setView((draft) => {
        draft.form = null;
      });
    },
    loadPaid() {
      if (!props.data.paidLoaded) props.onLoadPaid();
    },

    apply,
    async ok(change: CrmChange): Promise<boolean> {
      return (await apply(change))?.ok === true;
    },
    /** The id that a create change gave, or null when it failed. */
    async created(change: CrmChange): Promise<string | null> {
      const result = await apply(change);
      return result?.ok === true ? result.id : null;
    },
    updateCustomer(customer: CrmCustomer, patch: CrmCustomerPatch) {
      return crm.ok({ kind: "customer-update", customerId: customer.id, patch, baseRevision: customer.revision });
    },
    setTags(customer: CrmCustomer, tagIds: string[]) {
      return crm.ok({ kind: "customer-tags", customerId: customer.id, tagIds });
    },
    async createTag(customer: CrmCustomer, label: string) {
      const id = await crm.created({ kind: "tag-create", label });
      if (id !== null && !customer.tagIds.includes(id)) await crm.setTags(customer, [...customer.tagIds, id]);
    },
    async createStatus(customer: CrmCustomer, label: string) {
      const id = await crm.created({ kind: "status-create", label });
      // The new status changes the customer, so the update names the revision that the page read.
      const current = crm.customer(customer.id) ?? customer;
      if (id !== null) await crm.updateCustomer(current, { statusId: id });
    },
    setPrivate(field: CrmPrivateField, on: boolean) {
      const fields = privateFields().filter((item) => item !== field);
      return crm.ok({ kind: "private-fields", fields: on ? [...fields, field] : fields });
    },
    setAccess(agentId: string, on: boolean) {
      const kept = access().filter((id) => id !== agentId);
      return crm.ok({ kind: "agent-access", agentIds: on ? [...kept, agentId] : kept });
    },
    markPaid(paymentIds: readonly string[]) {
      if (paymentIds.length === 0) return Promise.resolve(false);
      return crm.ok({ kind: "payment-paid", paymentIds: [...paymentIds], paidAt: new Date().toISOString() });
    },
    markUnpaid(paymentId: string) {
      return crm.ok({ kind: "payment-paid", paymentIds: [paymentId], paidAt: null });
    },
    decide(proposal: CrmProposal, approve: boolean) {
      return crm.ok({ kind: "proposal-decide", proposalId: proposal.id, approve });
    },
  };
  return crm;
}

export type CrmViewModel = ReturnType<typeof createCrmView>;
