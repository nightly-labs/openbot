import type { CrmPayment } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  CalendarClock,
  Check,
  CircleCheck,
  CircleDot,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Hash,
  IconButton,
  Store,
  Tag,
  UserRound,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, Show } from "solid-js";
import { sheetLayout } from "./CrmCustomers";
import { Chips, Empty, Logo, Owner, PaymentMenu, PayStateBadge, useMarkPaid } from "./CrmParts";
import {
  ColumnsMenu,
  filterRows,
  orderColumns,
  Sheet,
  type SheetAction,
  type SheetColumn,
  sortRows,
  useCsvExport,
  visibleColumns,
} from "./CrmSheet";
import {
  CRM_PAY_VIEWS,
  type CrmPayView,
  daysLate,
  formatDay,
  formatTotals,
  inPayView,
  localDateOf,
  majorUnits,
  matches,
  PAY_STATE_KEY,
  PAY_VIEW_KEY,
  payState,
  totalsByCurrency,
} from "./crm-model";
import type { CrmViewModel } from "./crm-state";
import { useCrmText } from "./crm-text";

type PaymentColumn = SheetColumn<CrmPayment> & { views?: readonly CrmPayView[] };

function usePaymentColumns(crm: CrmViewModel): PaymentColumn[] {
  const { t, format } = useText();
  const text = useCrmText(crm);
  const customer = (payment: CrmPayment) => crm.customer(payment.customerId);
  const name = (payment: CrmPayment) => customer(payment)?.name ?? "";
  const late = (payment: CrmPayment) => payState(payment, crm.today()) === "late";
  const paidOn = (payment: CrmPayment) => (payment.paidAt === null ? null : localDateOf(payment.paidAt));
  const method = (payment: CrmPayment) => payment.method ?? customer(payment)?.method ?? null;
  const sums = (rows: readonly CrmPayment[]) =>
    formatTotals(
      format,
      totalsByCurrency(
        rows,
        (payment) => payment.amountMinor,
        (payment) => payment.currency,
      ),
    );
  return [
    {
      id: "customer",
      field: "name",
      label: t("crm.column.customer"),
      icon: Store,
      width: 220,
      sort: { kind: "text", value: name },
      cell: (payment) => (
        <span class="crm-sheet-name">
          <Logo name={name(payment)} />
          <Button variant="ghost" class="crm-sheet-open" onClick={() => crm.select(payment.customerId)}>
            {name(payment)}
          </Button>
        </span>
      ),
      text: name,
      total: (rows) => ({ label: t("crm.total.count"), lines: [format.number(rows.length)] }),
    },
    {
      id: "invoice",
      label: t("crm.column.invoice"),
      icon: FileText,
      width: 120,
      sort: { kind: "number", value: (payment) => payment.number },
      cell: (payment) => <span class="crm-invoice">{text.invoice(payment.number)}</span>,
      text: (payment) => text.invoice(payment.number),
    },
    {
      id: "amount",
      field: "amounts",
      label: t("crm.column.amount"),
      icon: Hash,
      width: 130,
      numeric: true,
      sort: { kind: "number", value: (payment) => payment.amountMinor },
      cell: (payment) => (
        <span class={late(payment) ? "crm-owed" : undefined}>{text.money(payment.amountMinor, payment.currency)}</span>
      ),
      text: (payment) => text.money(payment.amountMinor, payment.currency),
      filter: { range: (payment) => majorUnits(payment.amountMinor, payment.currency) },
      total: (rows) => ({ label: t("crm.total.sum"), lines: sums(rows) }),
    },
    {
      id: "due",
      field: "dates",
      label: t("crm.column.due"),
      icon: CalendarClock,
      width: 160,
      sort: { kind: "date", value: (payment) => payment.dueOn },
      cell: (payment) => (
        <Show when={payment.paidAt === null} fallback={formatDay(format, payment.dueOn)}>
          <span class="crm-due" data-late={late(payment) ? "" : undefined} title={formatDay(format, payment.dueOn)}>
            {text.due(payment.dueOn)}
          </span>
        </Show>
      ),
      text: (payment) => payment.dueOn,
      filter: "none",
    },
    {
      id: "status",
      label: t("crm.column.status"),
      icon: CircleDot,
      width: 120,
      views: ["all"],
      sort: { kind: "text", value: (payment) => t(PAY_STATE_KEY[payState(payment, crm.today())]) },
      cell: (payment) => <PayStateBadge crm={crm} payment={payment} />,
      text: (payment) => t(PAY_STATE_KEY[payState(payment, crm.today())]),
      total: (rows) => ({ label: t("crm.total.late"), lines: [format.number(rows.filter(late).length)] }),
    },
    {
      id: "paidOn",
      field: "dates",
      label: t("crm.column.paidOn"),
      icon: CircleCheck,
      width: 120,
      views: ["history", "all"],
      sort: { kind: "date", value: paidOn },
      cell: (payment) => (
        <Show when={paidOn(payment)} keyed>
          {(day) => formatDay(format, day)}
        </Show>
      ),
      text: (payment) => paidOn(payment) ?? "",
      filter: "none",
    },
    {
      id: "timing",
      field: "dates",
      label: t("crm.column.timing"),
      icon: Clock3,
      width: 130,
      views: ["history", "all"],
      sort: { kind: "number", value: (payment) => (payment.paidAt === null ? null : daysLate(payment, crm.today())) },
      cell: (payment) => (
        <Show when={payment.paidAt !== null}>
          <Badge variant={daysLate(payment, crm.today()) === 0 ? "success-light" : "warning-light"}>
            {text.timing(payment)}
          </Badge>
        </Show>
      ),
      text: (payment) => (payment.paidAt === null ? "" : text.timing(payment)),
      total: (rows) => ({
        label: t("crm.total.paidLate"),
        lines: [
          format.number(rows.filter((payment) => payment.paidAt !== null && daysLate(payment, crm.today()) > 0).length),
        ],
      }),
    },
    {
      id: "for",
      field: "plans",
      label: t("crm.column.for"),
      icon: Tag,
      width: 250,
      sort: { kind: "text", value: (payment) => payment.label },
      cell: (payment) => payment.label,
      text: (payment) => payment.label,
    },
    {
      id: "method",
      field: "method",
      label: t("crm.column.method"),
      icon: CreditCard,
      width: 150,
      sort: { kind: "text", value: (payment) => (method(payment) ? text.method(method(payment)) : null) },
      cell: (payment) => (
        <Show when={method(payment)} keyed>
          {(value) => <span class="crm-method">{text.method(value)}</span>}
        </Show>
      ),
      text: (payment) => (method(payment) ? text.method(method(payment)) : ""),
    },
    {
      id: "owner",
      field: "owner",
      label: t("crm.column.owner"),
      icon: UserRound,
      width: 170,
      sort: { kind: "text", value: (payment) => crm.agentName(customer(payment)?.ownerAgentId) },
      cell: (payment) => <Owner crm={crm} id={customer(payment)?.ownerAgentId ?? null} label />,
      text: (payment) => crm.agentName(customer(payment)?.ownerAgentId),
    },
  ];
}

export function CrmPayments(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const crm = props.crm;
  const text = useCrmText(crm);
  const exportCsv = useCsvExport();
  const markPaid = useMarkPaid(crm);
  const columns = usePaymentColumns(crm);
  const pay = () => crm.layout.pay;
  const ordered = createMemo(() => orderColumns(columns, crm.layout.payments.order));
  const viewColumns = createMemo(() => ordered().filter((column) => !column.views || column.views.includes(pay())));
  const shown = createMemo(() => visibleColumns(viewColumns(), crm.layout.payments.hidden));
  const layout = sheetLayout(crm, "payments", ordered, shown);
  const viewItems = createMemo(() => CRM_PAY_VIEWS.map((id) => ({ id, label: t(PAY_VIEW_KEY[id]) })));

  createEffect(pay, (view) => {
    if (view === "history" || view === "all") crm.loadPaid();
  });

  const rows = createMemo(() => {
    const list = crm
      .payments()
      .filter(
        (payment) =>
          inPayView(payment, pay(), crm.today()) &&
          matches(crm.view.query, payment.label, text.invoice(payment.number), crm.customer(payment.customerId)?.name),
      );
    return sortRows(filterRows(list, shown(), layout.find(), layout.range()), viewColumns(), crm.layout.payments.sort);
  });
  const picked = createMemo(() => rows().filter((payment) => crm.view.picked.includes(payment.id)));
  const setPicked = (ids: string[]) =>
    crm.setView((draft) => {
      draft.picked = ids;
    });
  const pickedOpen = () => picked().filter((payment) => payment.paidAt === null && payment.source === null);
  const action: SheetAction<CrmPayment> = {
    label: t("crm.payments.actions"),
    width: 48,
    cell: (payment) => <PaymentMenu crm={crm} payment={payment} />,
  };
  const allPaid = () => pay() === "late" && !crm.view.query && layout.filters() === 0;

  return (
    <div class="crm-sheet-view">
      <div class="crm-bar crm-sheet-view-bar">
        <Chips
          label={t("crm.tab.payments")}
          items={viewItems()}
          value={pay()}
          count={(id) => crm.payments().filter((payment) => inPayView(payment, id, crm.today())).length}
          onChange={(id) =>
            crm.setLayout((draft) => {
              draft.pay = id;
            })
          }
        />
        <div class="crm-sheet-view-tools">
          <Show
            when={picked().length > 0}
            fallback={
              <>
                <ColumnsMenu
                  columns={viewColumns()}
                  hidden={crm.layout.payments.hidden}
                  moved={crm.layout.payments.order.length > 0}
                  onChange={layout.onHidden}
                  onReset={layout.onReset}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportCsv(t("crm.export.paymentsFile"), shown(), rows())}
                >
                  <Download aria-hidden="true" />
                  {t("crm.export.button")}
                </Button>
              </>
            }
          >
            <span class="crm-picked" aria-live="polite">
              {t("crm.payments.picked", { count: picked().length })}
            </span>
            <Show when={pickedOpen().length > 0}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const open = pickedOpen();
                  setPicked([]);
                  void markPaid(open);
                }}
              >
                <Check aria-hidden="true" />
                {t("crm.payment.markPaid")}
              </Button>
            </Show>
            <IconButton
              label={t("crm.payments.clearPicked")}
              variant="ghost"
              size="icon-sm"
              onClick={() => setPicked([])}
            >
              <X aria-hidden="true" />
            </IconButton>
          </Show>
        </div>
      </div>
      <Sheet
        label={t("crm.tab.payments")}
        columns={shown()}
        rows={rows()}
        rowId={(payment) => payment.id}
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
        empty={<Empty title={allPaid() ? t("crm.customers.allPaid") : t("crm.payments.noMatch")} done={allPaid()} />}
        onOpen={(id) => {
          const payment = crm.payment(id);
          if (payment) crm.select(payment.customerId);
        }}
        current={(payment) => payment.customerId === crm.selected()}
        isPrivate={crm.isPrivate}
        onPrivate={(field, on) => void crm.setPrivate(field, on)}
        pick={{
          ids: crm.view.picked,
          label: (payment) =>
            t("crm.payments.pickLabel", { invoice: text.invoice(payment.number), label: payment.label }),
          onChange: setPicked,
        }}
        action={action}
      />
    </div>
  );
}
