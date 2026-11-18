import type { CrmCustomer, CrmPayment, CrmTone } from "@openbot/contracts/ipc";
import {
  Badge,
  buttonVariants,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CreditCard,
  DropdownMenu,
  Filter,
  IconButton,
  Input,
  Repeat,
  Search,
  Tag,
  UserRound,
  X,
} from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, flush, onCleanup, Show } from "solid-js";
import { createMenuSearch } from "../../components/createMenuSearch";
import { createScrollFades } from "../../components/createScrollFades";
import { MatchedName, matchByName, nameRank } from "../../components/name-match";
import type { CrmIcon } from "./CrmSheet";
import { MenuMark } from "./CrmSheet";
import {
  type CrmAgent,
  type CrmFilterField,
  type CrmFilterRule,
  type CustomerSummary,
  customerSummary,
  dueThisWeek,
  EVERY_KEY,
  METHOD_KEY,
} from "./crm-model";
import type { CrmViewModel } from "./crm-state";

/** A customer with its open payments, as the customer sheet shows it. */
export interface CustomerRow {
  customer: CrmCustomer;
  summary: CustomerSummary;
}

/** The customer rows, with the open payments of each customer. The paid ones come from the customer totals. */
export function createCustomerRows(crm: CrmViewModel) {
  const openByCustomer = createMemo(() => {
    const groups = new Map<string, CrmPayment[]>();
    for (const payment of crm.data().open) {
      const list = groups.get(payment.customerId);
      if (list) list.push(payment);
      else groups.set(payment.customerId, [payment]);
    }
    return groups;
  });
  return createMemo(() =>
    crm.customers().map(
      (customer): CustomerRow => ({
        customer,
        summary: customerSummary(openByCustomer().get(customer.id) ?? [], crm.today()),
      }),
    ),
  );
}

interface FilterOption {
  id: string;
  label: string;
  tone?: CrmTone;
  /** An owner: the agent, or null for no owner. */
  agent?: CrmAgent | null;
}

export interface FilterFieldDef {
  id: CrmFilterField;
  label: string;
  icon: CrmIcon;
  options: () => FilterOption[];
  test: (row: CustomerRow, value: string) => boolean;
}

/** The option of a field for a customer that has no value, such as no owner. */
const NONE = "none";

/** The filter fields of the customer sheet. */
export function useCustomerFilterFields(crm: CrmViewModel): FilterFieldDef[] {
  const { t } = useText();
  const paymentFits = (row: CustomerRow, value: string) => {
    if (value === "late") return row.customer.lateMinor > 0;
    if (value === "week") return dueThisWeek(row.summary, crm.today());
    if (value === "clear") return row.customer.statusId === "customer" && row.customer.lateMinor === 0;
    return row.customer.lastPaidAt === null;
  };
  return [
    {
      id: "status",
      label: t("crm.filter.status"),
      icon: CircleDot,
      options: () => crm.statuses().map((item) => ({ id: item.id, label: crm.statusText(item.id), tone: item.tone })),
      test: (row, value) => row.customer.statusId === value,
    },
    {
      id: "payment",
      label: t("crm.filter.payment"),
      icon: CircleAlert,
      options: () => [
        { id: "late", label: t("crm.filter.paymentLate") },
        { id: "week", label: t("crm.filter.paymentWeek") },
        { id: "clear", label: t("crm.filter.paymentClear") },
        { id: "never", label: t("crm.filter.paymentNever") },
      ],
      test: paymentFits,
    },
    {
      id: "tags",
      label: t("crm.filter.tags"),
      icon: Tag,
      options: () => crm.tags().map((tag) => ({ id: tag.id, label: tag.label })),
      test: (row, value) => row.customer.tagIds.includes(value),
    },
    {
      id: "method",
      label: t("crm.filter.method"),
      icon: CreditCard,
      options: () => [
        ...Object.entries(METHOD_KEY).map(([id, key]) => ({ id, label: t(key) })),
        { id: NONE, label: t("crm.method.none") },
      ],
      test: (row, value) => (row.customer.method ?? NONE) === value,
    },
    {
      id: "plan",
      label: t("crm.filter.plan"),
      icon: Repeat,
      options: () => [
        ...Object.entries(EVERY_KEY).map(([id, key]) => ({ id, label: t(key) })),
        { id: NONE, label: t("crm.filter.noPlan") },
      ],
      test: (row, value) =>
        value === NONE ? row.customer.plans.length === 0 : row.customer.plans.some((plan) => plan.every === value),
    },
    {
      id: "owner",
      label: t("crm.filter.owner"),
      icon: UserRound,
      options: () => [
        { id: NONE, label: crm.agentName(null), agent: null },
        ...crm.agents().map((agent) => ({ id: agent.id, label: agent.name, agent })),
      ],
      test: (row, value) => (row.customer.ownerAgentId ?? NONE) === value,
    },
  ];
}

/** True when the row fits all filters. `skip` leaves out the filter of one field, to count its options. */
export function fitsFilters(
  fields: readonly FilterFieldDef[],
  rules: readonly CrmFilterRule[],
  row: CustomerRow,
  skip: CrmFilterField | null = null,
): boolean {
  return rules.every((rule) => {
    const field = fields.find((item) => item.id === rule.field);
    return rule.field === skip || !field || rule.values.some((value) => field.test(row, value));
  });
}

function toggleFilter(crm: CrmViewModel, field: CrmFilterField, value: string) {
  crm.setLayout((draft) => {
    const rule = draft.filters.find((item) => item.field === field);
    if (!rule) {
      draft.filters.push({ field, values: [value] });
      return;
    }
    rule.values = rule.values.includes(value) ? rule.values.filter((item) => item !== value) : [...rule.values, value];
    if (rule.values.length === 0) draft.filters = draft.filters.filter((item) => item.field !== field);
  });
}

/** A value of a field, as a row of a filter menu. */
interface FilterRow {
  def: FilterFieldDef;
  option: FilterOption;
}

/** The values of `fields` that match the search. A match in the field name finds all values of the field. */
function findRows(fields: readonly FilterFieldDef[], query: string): FilterRow[] {
  return fields
    .flatMap((def) => {
      const fieldRank = nameRank(def.label, query);
      return def.options().flatMap((option) => {
        const ranks = [nameRank(option.label, query), fieldRank].filter((rank) => rank !== undefined);
        return ranks.length === 0 ? [] : [{ row: { def, option }, rank: Math.min(...ranks) }];
      });
    })
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.row);
}

/** The picked values of a field. */
function pickedOf(crm: CrmViewModel, field: CrmFilterField) {
  return crm.layout.filters.find((rule) => rule.field === field)?.values ?? [];
}

/** The face of a value: the agent of an owner, the mark of no owner, or the field icon in a search of all fields. */
function OptionLead(props: { row: FilterRow; fieldIcon: boolean }) {
  return (
    <Show
      when={props.row.option.agent !== undefined}
      fallback={
        <Show when={props.fieldIcon}>
          <props.row.def.icon aria-hidden="true" />
        </Show>
      }
    >
      <Show
        when={props.row.option.agent}
        keyed
        fallback={
          <span class="crm-owner-none" aria-hidden="true">
            <UserRound />
          </span>
        }
      >
        {(agent) => <AgentAvatar agent={agent} class="crm-avatar-sm" />}
      </Show>
    </Show>
  );
}

/** The value name, with the matched part in bold. A status keeps its color. */
function OptionName(props: { option: FilterOption; query: string }) {
  return (
    <Show
      when={props.option.tone}
      keyed
      fallback={<MatchedName class="crm-filter-name" name={props.option.label} query={props.query} />}
    >
      {(tone) => (
        <span class="crm-filter-name">
          <Badge variant={tone}>
            <MatchedName name={props.option.label} query={props.query} />
          </Badge>
        </span>
      )}
    </Show>
  );
}

/**
 * The menu of the filters, as the add menu of the agent dock: a search field that has the focus,
 * and rows under it that the arrow keys move through. A value row has a tick and the number of
 * customers that it shows; a click adds or removes the value, and the menu stays open. Without
 * `field`, the menu starts with the fields: a click on one shows its values, and typing finds
 * values in all fields at once, so "crypto" finds Pays by Crypto and "late" finds Payment Late.
 */
function FilterMenu(props: {
  crm: CrmViewModel;
  fields: readonly FilterFieldDef[];
  rows: readonly CustomerRow[];
  /** The field of a filter in the bar. The menu shows only its values. */
  field?: FilterFieldDef;
  trigger: () => JSX.Element;
}) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const [openedId, setOpenedId] = createSignal<CrmFilterField | null>(null);
  const count = countOf(props);
  /** The field whose values the menu shows: the filter of the chip, or the field that the user opened. */
  const field = () => props.field ?? props.fields.find((item) => item.id === openedId());
  const searching = () => query().trim() !== "";
  const values = createMemo((): FilterRow[] => {
    const def = field();
    if (def)
      return matchByName(
        def.options().map((option) => ({ def, option })),
        (row) => row.option.label,
        query(),
      );
    return searching() ? findRows(props.fields, query()) : [];
  });
  /** The number of rows in the list, so its height follows them. The empty text takes one row. */
  const rowCount = () => Math.max(1, field() || searching() ? values().length : props.fields.length);
  const empty = () => (field() || searching()) && values().length === 0;
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const menu = createMenuSearch({
    row: ':is([role="menuitem"], [role="menuitemcheckbox"]):not([data-disabled], .crm-filter-back)',
    enter: searching,
  });
  let input: HTMLInputElement | undefined;
  /** True just after the menu changed its rows. Then the search field takes back the focus. */
  let holdField = false;
  const reset = () => {
    const list = menu.list();
    if (list) list.scrollTop = 0;
    fades.remeasure();
  };
  const search = (value: string) => {
    setQuery(value);
    reset();
  };
  const searchLabel = () => {
    const def = field();
    return def ? t("crm.filter.findValue", { field: def.label }) : t("crm.filter.find");
  };
  /** Shows the values of a field, or the fields again, with an empty search and the focus in it. */
  const openField = (id: CrmFilterField | null) => {
    setOpenedId(id);
    setQuery("");
    flush();
    reset();
    // The menu moves the focus to a row after the chosen row goes. The field keeps it until the next frames.
    holdField = true;
    input?.focus();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        holdField = false;
      }),
    );
  };
  return (
    <DropdownMenu.Root
      placement="bottom-start"
      gutter={4}
      onOpenChange={(open) => {
        if (!open) return;
        setQuery("");
        setOpenedId(null);
      }}
    >
      {props.trigger()}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class="crm-filter-menu"
          onOpenAutoFocus={menu.onOpenAutoFocus}
          onFocusIn={(event: FocusEvent) => {
            if (holdField && event.target !== input) input?.focus();
            else menu.onFocusIn(event);
          }}
        >
          <Show when={!props.field && field()} keyed>
            {(def) => (
              <DropdownMenu.Item class="crm-filter-back" closeOnSelect={false} onSelect={() => openField(null)}>
                <ChevronLeft aria-hidden="true" />
                {def.label}
              </DropdownMenu.Item>
            )}
          </Show>
          <div class="crm-filter-search">
            <Search aria-hidden="true" />
            <Input
              ref={(element: HTMLInputElement) => {
                input = element;
                menu.bindField(element);
              }}
              class="crm-filter-search-input"
              aria-label={searchLabel()}
              placeholder={searchLabel()}
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onValueChange={search}
              onKeyDown={(event: KeyboardEvent) => {
                // Backspace in an empty search goes back to the fields.
                if (event.key === "Backspace" && query() === "" && !props.field && openedId() !== null) {
                  event.preventDefault();
                  openField(null);
                  return;
                }
                menu.onFieldKey(event);
              }}
            />
          </div>
          <div
            class={["crm-filter-list", fades.classes()]}
            style={{ "--crm-filter-rows": String(rowCount()) }}
            ref={(element: HTMLDivElement) => {
              menu.bindList(element);
              fades.bind(element);
            }}
            onScroll={fades.measure}
          >
            <Show when={empty()}>
              <DropdownMenu.Item disabled>{t("crm.filter.none")}</DropdownMenu.Item>
            </Show>
            <Show when={!field() && !searching()}>
              <For each={props.fields}>
                {(def) => (
                  <DropdownMenu.Item closeOnSelect={false} onSelect={() => openField(def.id)}>
                    <def.icon aria-hidden="true" />
                    <span class="crm-filter-name">{def.label}</span>
                    <Show when={pickedOf(props.crm, def.id).length > 0}>
                      <span class="ui-menu-trailing crm-filter-count">{pickedOf(props.crm, def.id).length}</span>
                    </Show>
                    <ChevronRight class="crm-filter-next" aria-hidden="true" />
                  </DropdownMenu.Item>
                )}
              </For>
            </Show>
            <For each={values()}>
              {(row) => {
                const on = () => pickedOf(props.crm, row.def.id).includes(row.option.id);
                return (
                  <DropdownMenu.CheckboxItem
                    checked={on()}
                    closeOnSelect={false}
                    onChange={() => toggleFilter(props.crm, row.def.id, row.option.id)}
                  >
                    <MenuMark on={on()} />
                    <OptionLead row={row} fieldIcon={!field()} />
                    <OptionName option={row.option} query={query()} />
                    <Show when={!field()}>
                      <MatchedName class="crm-filter-field" name={row.def.label} query={query()} />
                    </Show>
                    <span class="ui-menu-trailing crm-filter-count">{count(row.def, row.option.id)}</span>
                  </DropdownMenu.CheckboxItem>
                );
              }}
            </For>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The number of customers that an option shows, with the other filters on. */
function countOf(props: { crm: CrmViewModel; fields: readonly FilterFieldDef[]; rows: readonly CustomerRow[] }) {
  return (field: FilterFieldDef, value: string) =>
    props.rows.filter(
      (row) => fitsFilters(props.fields, props.crm.layout.filters, row, field.id) && field.test(row, value),
    ).length;
}

/** One filter in the bar: "Status Lead, Trial". A click changes the values; the cross removes the filter. */
export function FilterChip(props: {
  crm: CrmViewModel;
  fields: readonly FilterFieldDef[];
  rule: CrmFilterRule;
  rows: readonly CustomerRow[];
}) {
  const { t } = useText();
  const field = () => props.fields.find((item) => item.id === props.rule.field);
  const names = () => {
    const options = field()?.options() ?? [];
    const labels = props.rule.values.map((value) => options.find((option) => option.id === value)?.label ?? value);
    const [first] = labels;
    return labels.length > 2 && first !== undefined
      ? t("crm.filter.more", { first, count: labels.length - 1 })
      : labels.join(", ");
  };
  return (
    <Show when={field()} keyed>
      {(def) => (
        <span class="crm-filter-chip">
          <FilterMenu
            crm={props.crm}
            fields={props.fields}
            rows={props.rows}
            field={def}
            trigger={() => (
              <DropdownMenu.Trigger class="crm-filter-chip-button">
                <def.icon aria-hidden="true" />
                <span class="crm-filter-chip-field">{def.label}</span>
                <span class="crm-filter-chip-values">{names()}</span>
              </DropdownMenu.Trigger>
            )}
          />
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={t("crm.filter.remove", { field: def.label })}
            onClick={() =>
              props.crm.setLayout((draft) => {
                draft.filters = draft.filters.filter((item) => item.field !== props.rule.field);
              })
            }
          >
            <X aria-hidden="true" />
          </IconButton>
        </span>
      )}
    </Show>
  );
}

/** "Add filter": the fields, and a search that finds values in all of them. */
export function AddFilter(props: {
  crm: CrmViewModel;
  fields: readonly FilterFieldDef[];
  rows: readonly CustomerRow[];
  compact: boolean;
}) {
  const { t } = useText();
  return (
    <FilterMenu
      crm={props.crm}
      fields={props.fields}
      rows={props.rows}
      trigger={() => (
        <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "sm" })}>
          <Filter aria-hidden="true" />
          {props.compact ? t("crm.filter.short") : t("crm.filter.add")}
        </DropdownMenu.Trigger>
      )}
    />
  );
}
