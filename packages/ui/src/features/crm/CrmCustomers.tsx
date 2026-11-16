import type { CrmTextField } from "@openbot/contracts/ipc";
import {
  Button,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Globe2,
  Hash,
  Link,
  Mail,
  Repeat,
  Sparkles,
  Store,
  Tag,
  UserRound,
  UsersRound,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import {
  AddFilter,
  type CustomerRow,
  createCustomerRows,
  FilterChip,
  fitsFilters,
  useCustomerFilterFields,
} from "./CrmFilters";
import { Empty, Logo, Owner, StatusPicker } from "./CrmParts";
import {
  ColumnsMenu,
  type CrmIcon,
  filterCount,
  filterRows,
  moveColumn,
  orderColumns,
  placeColumn,
  Sheet,
  type SheetColumn,
  sortRows,
  useCsvExport,
  visibleColumns,
} from "./CrmSheet";
import {
  activePlans,
  daysBetween,
  dueThisWeek,
  FIELD_KEY,
  formatDay,
  formatTotals,
  localDateOf,
  majorUnits,
  matches,
  monthlyMinor,
  type SheetRange,
  type SheetState,
  totalsByCurrency,
} from "./crm-model";
import type { CrmViewModel } from "./crm-state";
import { useCrmText } from "./crm-text";

/** The text fields that the customer sheet has as columns, with their icons. */
const TEXT_COLUMNS: { field: CrmTextField; icon: CrmIcon; width: number }[] = [
  { field: "contactName", icon: UsersRound, width: 170 },
  { field: "contactEmail", icon: Mail, width: 220 },
  { field: "phone", icon: Hash, width: 150 },
  { field: "billingEmail", icon: Mail, width: 220 },
  { field: "domain", icon: Globe2, width: 190 },
  { field: "taxId", icon: Hash, width: 150 },
  { field: "address", icon: FileText, width: 240 },
  { field: "stripeCustomerId", icon: CreditCard, width: 190 },
  { field: "notes", icon: FileText, width: 260 },
];

/**
 * The layout handlers of one sheet: sort, hide, move, place, width and the filter row. They write
 * the layout that the page keeps for the viewer.
 */
export function sheetLayout<R>(
  crm: CrmViewModel,
  key: "customers" | "payments",
  ordered: () => readonly SheetColumn<R>[],
  shown: () => readonly SheetColumn<R>[],
) {
  const sheet = (): SheetState => crm.layout[key];
  const ids = (columns: readonly SheetColumn<R>[]) => columns.map((column) => column.id);
  const setOrder = (order: string[]) =>
    crm.setLayout((draft) => {
      draft[key].order = order;
    });
  return {
    sheet,
    sort: () => sheet().sort,
    widths: () => sheet().widths,
    onSort: (sort: SheetState["sort"]) =>
      crm.setLayout((draft) => {
        draft[key].sort = sort;
      }),
    onHide: (id: string) =>
      crm.setLayout((draft) => {
        draft[key].hidden = [...draft[key].hidden, id];
      }),
    onHidden: (hidden: string[]) =>
      crm.setLayout((draft) => {
        draft[key].hidden = hidden;
      }),
    onReset: () => setOrder([]),
    onMove: (id: string, step: -1 | 1) => setOrder(moveColumn(ids(ordered()), ids(shown()), id, step)),
    onPlace: (id: string, target: string, after: boolean) => setOrder(placeColumn(ids(ordered()), id, target, after)),
    onWidth: (id: string, width: number | null) =>
      crm.setLayout((draft) => {
        if (width === null) delete draft[key].widths[id];
        else draft[key].widths[id] = width;
      }),
    find: () => sheet().find,
    range: () => sheet().range,
    /** The number of columns that the filter row filters. */
    filters: () => filterCount(shown(), sheet().find, sheet().range),
    onFind: (id: string, text: string) =>
      crm.setLayout((draft) => {
        if (text === "") delete draft[key].find[id];
        else draft[key].find[id] = text;
      }),
    onRange: (id: string, range: SheetRange | null) =>
      crm.setLayout((draft) => {
        if (range === null) delete draft[key].range[id];
        else draft[key].range[id] = range;
      }),
    onClearFilters: () =>
      crm.setLayout((draft) => {
        draft[key].find = {};
        draft[key].range = {};
      }),
  };
}

function useCustomerColumns(crm: CrmViewModel): SheetColumn<CustomerRow>[] {
  const { t, format } = useText();
  const text = useCrmText(crm);
  const pending = createMemo(() => new Set(crm.proposals().flatMap((item) => item.customerId ?? [])));
  const count = (rows: readonly CustomerRow[], test: (row: CustomerRow) => boolean) =>
    format.number(rows.filter(test).length);
  const sums = (rows: readonly CustomerRow[], amount: (row: CustomerRow) => number) =>
    formatTotals(
      format,
      totalsByCurrency(rows, amount, (row) => row.customer.currency),
    );
  const oldestLate = (row: CustomerRow) => row.summary.late[0];
  const plansMonthly = (row: CustomerRow) =>
    activePlans(row.customer, crm.today()).reduce((sum, plan) => sum + monthlyMinor(plan), 0);
  const plansText = (row: CustomerRow) =>
    format.list(
      activePlans(row.customer, crm.today()).map((plan) =>
        t("crm.customers.planText", { plan: plan.name, price: text.price(plan, row.customer.currency) }),
      ),
    );
  const lastPaid = (row: CustomerRow) => (row.customer.lastPaidAt ? localDateOf(row.customer.lastPaidAt) : null);

  return [
    {
      id: "customer",
      field: "name",
      label: t("crm.column.customer"),
      icon: Store,
      width: 230,
      sort: { kind: "text", value: (row) => row.customer.name },
      cell: (row) => (
        <span class="crm-sheet-name">
          <Logo name={row.customer.name} />
          <Button variant="ghost" class="crm-sheet-open" onClick={() => crm.select(row.customer.id)}>
            {row.customer.name}
          </Button>
          <Show when={pending().has(row.customer.id)}>
            <span role="img" aria-label={t("crm.customers.pending")} class="crm-pending-mark">
              <Sparkles aria-hidden="true" />
            </span>
          </Show>
        </span>
      ),
      text: (row) => row.customer.name,
      total: (rows) => ({ label: t("crm.total.count"), lines: [format.number(rows.length)] }),
    },
    {
      id: "next",
      field: "dates",
      label: t("crm.column.next"),
      icon: CalendarClock,
      width: 160,
      sort: { kind: "date", value: (row) => row.summary.next?.dueOn ?? null },
      cell: (row) => (
        <Show when={row.summary.next} keyed>
          {(next) => (
            <span
              class="crm-due"
              data-late={daysBetween(crm.today(), next.dueOn) < 0 ? "" : undefined}
              title={formatDay(format, next.dueOn)}
            >
              {text.due(next.dueOn)}
            </span>
          )}
        </Show>
      ),
      text: (row) => row.summary.next?.dueOn ?? "",
      filter: "none",
      total: (rows) => ({
        label: t("crm.total.thisWeek"),
        lines: [count(rows, (row) => dueThisWeek(row.summary, crm.today()))],
      }),
    },
    {
      id: "amount",
      field: "amounts",
      label: t("crm.column.amount"),
      icon: Hash,
      width: 130,
      numeric: true,
      sort: { kind: "number", value: (row) => row.summary.next?.amountMinor ?? null },
      cell: (row) => (
        <Show when={row.summary.next} keyed>
          {(next) => text.money(next.amountMinor, next.currency)}
        </Show>
      ),
      text: (row) => (row.summary.next ? text.money(row.summary.next.amountMinor, row.summary.next.currency) : ""),
      filter: {
        range: (row) => (row.summary.next ? majorUnits(row.summary.next.amountMinor, row.summary.next.currency) : null),
      },
      total: (rows) => ({ label: t("crm.total.sum"), lines: sums(rows, (row) => row.summary.next?.amountMinor ?? 0) }),
    },
    {
      id: "owed",
      field: "amounts",
      label: t("crm.column.owed"),
      icon: CircleAlert,
      width: 130,
      numeric: true,
      sort: { kind: "number", value: (row) => row.customer.lateMinor || null },
      cell: (row) => (
        <Show when={row.customer.lateMinor > 0}>
          <span class="crm-owed">{text.money(row.customer.lateMinor, row.customer.currency)}</span>
        </Show>
      ),
      text: (row) => (row.customer.lateMinor > 0 ? text.money(row.customer.lateMinor, row.customer.currency) : ""),
      filter: { range: (row) => majorUnits(row.customer.lateMinor, row.customer.currency) },
      total: (rows) => ({ label: t("crm.total.sum"), lines: sums(rows, (row) => row.customer.lateMinor) }),
    },
    {
      id: "late",
      field: "dates",
      label: t("crm.column.late"),
      icon: Clock3,
      width: 120,
      sort: {
        kind: "number",
        value: (row) => {
          const oldest = oldestLate(row);
          return oldest ? -daysBetween(crm.today(), oldest.dueOn) : null;
        },
      },
      cell: (row) => (
        <Show when={oldestLate(row)} keyed>
          {(oldest) => (
            <span class="crm-late">
              {t("crm.customers.lateDays", { count: -daysBetween(crm.today(), oldest.dueOn) })}
            </span>
          )}
        </Show>
      ),
      text: (row) => {
        const oldest = oldestLate(row);
        return oldest ? String(-daysBetween(crm.today(), oldest.dueOn)) : "";
      },
      filter: {
        range: (row) => {
          const oldest = oldestLate(row);
          return oldest ? -daysBetween(crm.today(), oldest.dueOn) : 0;
        },
      },
      total: (rows) => ({ label: t("crm.total.late"), lines: [count(rows, (row) => row.customer.lateMinor > 0)] }),
    },
    {
      id: "status",
      field: "status",
      label: t("crm.column.status"),
      icon: CircleDot,
      width: 150,
      sort: {
        kind: "number",
        value: (row) => crm.statuses().findIndex((item) => item.id === row.customer.statusId),
      },
      cell: (row) => <StatusPicker crm={crm} customer={row.customer} />,
      text: (row) => crm.statusText(row.customer.statusId),
      total: (rows) => ({
        label: t("crm.total.leads"),
        lines: [count(rows, (row) => row.customer.statusId === "lead")],
      }),
    },
    {
      id: "plan",
      field: "plans",
      label: t("crm.column.plan"),
      icon: Repeat,
      width: 240,
      sort: { kind: "number", value: (row) => plansMonthly(row) || null },
      cell: (row) => plansText(row),
      text: (row) => plansText(row),
      total: (rows) => ({ label: t("crm.total.perMonth"), lines: sums(rows, plansMonthly) }),
    },
    {
      id: "method",
      field: "method",
      label: t("crm.column.method"),
      icon: CreditCard,
      width: 140,
      sort: { kind: "text", value: (row) => (row.customer.method ? text.method(row.customer.method) : null) },
      cell: (row) => (
        <Show when={row.customer.method} keyed>
          {(method) => <span class="crm-method">{text.method(method)}</span>}
        </Show>
      ),
      text: (row) => (row.customer.method ? text.method(row.customer.method) : ""),
    },
    {
      id: "tags",
      field: "tags",
      label: t("crm.column.tags"),
      icon: Tag,
      width: 200,
      sort: { kind: "text", value: (row) => crm.tagLabels(row.customer.tagIds)[0] ?? null },
      cell: (row) => (
        <span class="crm-tags">
          <For each={crm.tagLabels(row.customer.tagIds)}>{(label) => <span class="crm-tag">{label}</span>}</For>
        </span>
      ),
      text: (row) => crm.tagLabels(row.customer.tagIds).join("; "),
    },
    {
      id: "lastPaid",
      field: "dates",
      label: t("crm.column.lastPaid"),
      icon: CircleCheck,
      width: 120,
      sort: { kind: "date", value: lastPaid },
      cell: (row) => (
        <Show when={lastPaid(row)} keyed>
          {(day) => formatDay(format, day)}
        </Show>
      ),
      text: (row) => lastPaid(row) ?? "",
      filter: "none",
    },
    {
      id: "paid",
      field: "amounts",
      label: t("crm.column.paid"),
      icon: CircleCheck,
      width: 130,
      numeric: true,
      sort: { kind: "number", value: (row) => row.customer.paidMinor || null },
      cell: (row) => (
        <Show when={row.customer.paidMinor > 0}>{text.money(row.customer.paidMinor, row.customer.currency)}</Show>
      ),
      text: (row) => (row.customer.paidMinor > 0 ? text.money(row.customer.paidMinor, row.customer.currency) : ""),
      filter: { range: (row) => majorUnits(row.customer.paidMinor, row.customer.currency) },
      total: (rows) => ({ label: t("crm.total.sum"), lines: sums(rows, (row) => row.customer.paidMinor) }),
    },
    {
      id: "owner",
      field: "owner",
      label: t("crm.column.owner"),
      icon: UserRound,
      width: 170,
      sort: { kind: "text", value: (row) => crm.agentName(row.customer.ownerAgentId) },
      cell: (row) => <Owner crm={crm} id={row.customer.ownerAgentId} label />,
      text: (row) => crm.agentName(row.customer.ownerAgentId),
    },
    ...TEXT_COLUMNS.map(
      (column): SheetColumn<CustomerRow> => ({
        id: column.field,
        label: t(FIELD_KEY[column.field]),
        icon: column.icon,
        width: column.width,
        field: column.field,
        sort: { kind: "text", value: (row) => row.customer[column.field] || null },
        cell: (row) =>
          column.field === "domain" && row.customer.domain ? (
            <span class="crm-sheet-link">
              <Link class="crm-sheet-link-icon" aria-hidden="true" />
              {row.customer.domain}
            </span>
          ) : (
            row.customer[column.field]
          ),
        text: (row) => row.customer[column.field],
      }),
    ),
  ];
}

export function CrmCustomers(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const crm = props.crm;
  const exportCsv = useCsvExport();
  const columns = useCustomerColumns(crm);
  const fields = useCustomerFilterFields(crm);
  const all = createCustomerRows(crm);
  const ordered = createMemo(() => orderColumns(columns, crm.layout.customers.order));
  const shown = createMemo(() => visibleColumns(ordered(), crm.layout.customers.hidden));
  const layout = sheetLayout(crm, "customers", ordered, shown);
  const rows = createMemo(() => {
    const list = all()
      .filter(
        (row) =>
          fitsFilters(fields, crm.layout.filters, row) &&
          matches(
            crm.view.query,
            row.customer.name,
            row.customer.domain,
            row.customer.contactName,
            row.customer.contactEmail,
            ...crm.tagLabels(row.customer.tagIds),
          ),
      )
      .sort((a, b) => a.customer.name.localeCompare(b.customer.name));
    return sortRows(filterRows(list, shown(), layout.find(), layout.range()), columns, crm.layout.customers.sort);
  });
  const onlyLate = () =>
    !crm.view.query &&
    layout.filters() === 0 &&
    crm.layout.filters.length === 1 &&
    crm.layout.filters[0]?.field === "payment" &&
    crm.layout.filters[0].values.join() === "late";
  const emptyTitle = () => {
    if (crm.customers().length === 0) return t("crm.customers.none");
    return onlyLate() ? t("crm.customers.allPaid") : t("crm.customers.noMatch");
  };

  return (
    <div class="crm-sheet-view">
      <div class="crm-bar crm-sheet-view-bar">
        <div class="crm-filters">
          <span class="crm-filter-total">{t("crm.customers.count", { count: rows().length })}</span>
          <For each={crm.layout.filters}>
            {(rule) => <FilterChip crm={crm} fields={fields} rule={rule} rows={all()} />}
          </For>
          <AddFilter crm={crm} fields={fields} rows={all()} compact={crm.layout.filters.length > 0} />
          <Show when={crm.layout.filters.length + layout.filters() > 1}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                layout.onClearFilters();
                crm.setLayout((draft) => {
                  draft.filters = [];
                });
              }}
            >
              {t("crm.filter.clear")}
            </Button>
          </Show>
        </div>
        <div class="crm-sheet-view-tools">
          <ColumnsMenu
            columns={ordered()}
            hidden={crm.layout.customers.hidden}
            moved={crm.layout.customers.order.length > 0}
            onChange={layout.onHidden}
            onReset={layout.onReset}
          />
          <Button variant="ghost" size="sm" onClick={() => exportCsv(t("crm.export.customersFile"), shown(), rows())}>
            <Download aria-hidden="true" />
            {t("crm.export.button")}
          </Button>
        </div>
      </div>
      {/* The sheet stays when filters hide all rows, so the filter row stays to change them. */}
      <Show when={crm.customers().length > 0} fallback={<Empty title={emptyTitle()} />}>
        <Sheet
          label={t("crm.tab.customers")}
          columns={shown()}
          rows={rows()}
          rowId={(row) => row.customer.id}
          sort={layout.sort()}
          widths={layout.widths()}
          onSort={layout.onSort}
          onHide={layout.onHide}
          onMove={layout.onMove}
          onPlace={layout.onPlace}
          onWidth={layout.onWidth}
          find={layout.find()}
          range={layout.range()}
          onFind={layout.onFind}
          onRange={layout.onRange}
          onClearFilters={layout.onClearFilters}
          empty={<Empty title={emptyTitle()} done={onlyLate()} />}
          onOpen={(id) => crm.select(id)}
          current={(row) => row.customer.id === crm.selected()}
          isPrivate={crm.isPrivate}
          onPrivate={(field, on) => void crm.setPrivate(field, on)}
        />
      </Show>
    </div>
  );
}
