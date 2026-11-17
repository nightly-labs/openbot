import type { CrmCustomer, CrmPayment, CrmPlan, CrmSourceKind, CrmTextField } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  CircleCheck,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Input,
  Lock,
  Pencil,
  Plus,
  Popover,
  SearchSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Split,
  SwitchField,
  Textarea,
  Trash2,
  toast,
  Undo2,
  UserRound,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { createAutoScroll, MenuMark } from "./CrmSheet";
import { FIELD_KEY, matches, PAY_STATE_KEY, payState, payVariant, SOURCE_KEY } from "./crm-model";
import type { CrmViewModel } from "./crm-state";
import { useCrmText } from "./crm-text";

/** The first letter of a customer, in place of a logo. */
export function Logo(props: { name: string }) {
  return (
    <span class="crm-logo" aria-hidden="true">
      {props.name.slice(0, 1)}
    </span>
  );
}

export function Empty(props: { title: string; done?: boolean }) {
  return (
    <div class="crm-empty">
      <Show when={props.done}>
        <CircleCheck aria-hidden="true" />
      </Show>
      <h2>{props.title}</h2>
    </div>
  );
}

/** An agent with its avatar. With `label`, the name shows; without it, only a screen reader reads it. */
export function Owner(props: { crm: CrmViewModel; id: string | null; label?: boolean }) {
  return (
    <span class="crm-owner" title={props.label ? undefined : props.crm.agentName(props.id)}>
      <Show
        when={props.crm.agent(props.id)}
        keyed
        fallback={
          <span class="crm-owner-none" aria-hidden="true">
            <UserRound />
          </span>
        }
      >
        {(agent) => <AgentAvatar agent={agent} class="crm-avatar-sm" motion="hover" />}
      </Show>
      <span class={props.label ? undefined : "sr-only"}>{props.crm.agentName(props.id)}</span>
    </span>
  );
}

/** The option of the owner picker for a customer with no owner. */
const NO_OWNER = "none";

/** Finds an agent by name, so the list works for a server with many agents. */
export function OwnerSelect(props: {
  crm: CrmViewModel;
  value: string | null;
  onChange: (id: string | null) => void;
  labelledBy?: string;
  label?: string;
}) {
  // The picker keeps one options array while the agents stay the same.
  const options = createMemo(() => [NO_OWNER, ...props.crm.agents().map((agent) => agent.id)]);
  const idOf = (option: string) => (option === NO_OWNER ? null : option);
  return (
    <SearchSelect<string>
      options={options()}
      value={props.value ?? NO_OWNER}
      onChange={(option) => {
        const id = idOf(option);
        if (id !== props.value) props.onChange(id);
      }}
      label={(option) => props.crm.agentName(idOf(option))}
      itemContent={(option) => <Owner crm={props.crm} id={idOf(option)} label />}
      size="sm"
      class="crm-select"
      aria-labelledby={props.labelledBy}
      aria-label={props.label}
    >
      <Owner crm={props.crm} id={props.value} label />
    </SearchSelect>
  );
}

/** A value in the drawer. A click edits it in place; Enter or a click outside saves, Escape cancels. */
export function TextField(props: {
  label: string;
  value: string;
  display?: string | undefined;
  type?: "text" | "email" | "tel" | "url" | undefined;
  /** Shows after the label, such as a mark that agents do not see the value. */
  mark?: JSX.Element;
  /** A long value, such as notes. Enter adds a line; Cmd or Ctrl with Enter saves. */
  multiline?: boolean | undefined;
  maxLength?: number | undefined;
  onSave: (value: string) => void;
}) {
  const { t } = useText();
  const [editing, setEditing] = createSignal(false);
  let draft = "";
  const finish = (keep: boolean) => {
    if (!editing()) return;
    setEditing(false);
    if (keep && draft.trim() !== props.value) props.onSave(draft.trim());
  };
  const shown = () => props.display || props.value;
  return (
    <div class="crm-field">
      <dt>
        {props.label}
        {props.mark}
      </dt>
      <dd>
        <Show
          when={editing()}
          fallback={
            <Button
              variant="ghost"
              size="sm"
              class="crm-inline"
              aria-label={t("crm.field.edit", { field: props.label, value: shown() })}
              onClick={() => {
                draft = props.value;
                setEditing(true);
              }}
            >
              <span data-empty={shown() === "" ? "" : undefined}>{shown() || t("crm.field.add")}</span>
              <Pencil aria-hidden="true" class="crm-inline-pencil" />
            </Button>
          }
        >
          <Show
            when={props.multiline}
            fallback={
              <Input
                size="sm"
                type={props.type ?? "text"}
                aria-label={props.label}
                value={props.value}
                maxlength={props.maxLength}
                ref={(element: HTMLInputElement) => requestAnimationFrame(() => element.select())}
                onValueChange={(value) => {
                  draft = value;
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") finish(true);
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    finish(false);
                  }
                }}
                onBlur={() => finish(true)}
              />
            }
          >
            <Textarea
              size="sm"
              rows={4}
              aria-label={props.label}
              value={props.value}
              maxlength={props.maxLength}
              ref={(element: HTMLTextAreaElement) => requestAnimationFrame(() => element.focus())}
              onValueChange={(value) => {
                draft = value;
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) finish(true);
                if (event.key === "Escape") {
                  event.stopPropagation();
                  finish(false);
                }
              }}
              onBlur={() => finish(true)}
            />
          </Show>
        </Show>
      </dd>
    </div>
  );
}

/** The customer name as a heading. A click on it edits it. An empty name is not saved. */
export function NameField(props: { value: string; onSave: (value: string) => void }) {
  const { t } = useText();
  const [editing, setEditing] = createSignal(false);
  let draft = "";
  const finish = (keep: boolean) => {
    if (!editing()) return;
    setEditing(false);
    const next = draft.trim();
    if (keep && next !== "" && next !== props.value) props.onSave(next);
  };
  return (
    <Show
      when={editing()}
      fallback={
        <h2 class="crm-side-title">
          <Button
            variant="ghost"
            size="sm"
            class="crm-name-edit"
            aria-label={t("crm.field.edit", { field: t("crm.field.name"), value: props.value })}
            onClick={() => {
              draft = props.value;
              setEditing(true);
            }}
          >
            <span>{props.value}</span>
            <Pencil aria-hidden="true" class="crm-inline-pencil" />
          </Button>
        </h2>
      }
    >
      <Input
        class="crm-name-input"
        aria-label={t("crm.field.name")}
        value={props.value}
        ref={(element: HTMLInputElement) => requestAnimationFrame(() => element.select())}
        onValueChange={(value) => {
          draft = value;
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Enter") finish(true);
          if (event.key === "Escape") {
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </Show>
  );
}

/** A short fixed list. `options` must stay the same array while the control shows. */
export function ChoiceSelect<T extends string>(props: {
  options: T[];
  value: T;
  text: (value: T) => string;
  onChange: (value: T) => void;
  labelledBy: string;
}) {
  return (
    <Select<T>
      options={props.options}
      value={props.value}
      onChange={(next) => {
        if (next && next !== props.value) props.onChange(next);
      }}
      itemComponent={(item) => <SelectItem item={item.item}>{props.text(item.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" class="crm-select" aria-labelledby={props.labelledBy}>
        <SelectValue<T>>{() => props.text(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}

export function ChoiceField<T extends string>(props: {
  label: string;
  options: T[];
  value: T;
  text: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const labelId = createUniqueId();
  return (
    <div class="crm-field">
      <dt id={labelId}>{props.label}</dt>
      <dd>
        <ChoiceSelect
          options={props.options}
          value={props.value}
          text={props.text}
          onChange={props.onChange}
          labelledBy={labelId}
        />
      </dd>
    </div>
  );
}

/** A form control that names itself with a label element, for controls that are not inputs. */
export function LabelledControl(props: { label: string; children: (labelId: string) => JSX.Element; wide?: boolean }) {
  const labelId = createUniqueId();
  return (
    <div class={props.wide ? "ui-field crm-wide" : "ui-field"}>
      <span class="ui-label" id={labelId}>
        {props.label}
      </span>
      {props.children(labelId)}
    </div>
  );
}

export function PanelSection(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  const headingId = createUniqueId();
  return (
    <section class="crm-side-section" aria-labelledby={headingId}>
      <div class="crm-side-section-head">
        <h3 id={headingId}>{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function Glance(props: { label: string; value: string; detail?: string | undefined; late?: boolean }) {
  return (
    <div class="crm-glance-cell" data-late={props.late ? "" : undefined}>
      <span class="crm-glance-label">{props.label}</span>
      <span class="crm-glance-value">{props.value}</span>
      <Show when={props.detail}>
        <span class="crm-glance-detail">{props.detail}</span>
      </Show>
    </div>
  );
}

/** A lock after a field label when agents do not see the field. A click shows the field to agents again. */
export function PrivateMark(props: { crm: CrmViewModel; field: CrmTextField }) {
  const { t } = useText();
  const label = () => t(FIELD_KEY[props.field]);
  return (
    <Show when={props.crm.isPrivate(props.field)}>
      <IconButton
        variant="ghost"
        size="icon-xs"
        class="crm-private-mark"
        label={t("crm.private.show", { field: label() })}
        tooltip={t("crm.private.hidden", { field: label() })}
        onClick={() => void props.crm.setPrivate(props.field, false)}
      >
        <Lock aria-hidden="true" />
      </IconButton>
    </Show>
  );
}

/** The tags of a customer, and a picker that finds a tag or makes a new one. */
export function TagPicker(props: { crm: CrmViewModel; customer: CrmCustomer }) {
  const { t } = useText();
  const crm = props.crm;
  const [query, setQuery] = createSignal("");
  const tagIds = () => props.customer.tagIds;
  const save = (next: string[]) => void crm.setTags(props.customer, next);
  const toggle = (id: string) =>
    save(tagIds().includes(id) ? tagIds().filter((item) => item !== id) : [...tagIds(), id]);
  const found = () => crm.tags().filter((tag) => matches(query(), tag.label));
  const exact = () => crm.tags().find((tag) => tag.label.toLowerCase() === query().trim().toLowerCase());
  const create = () => {
    const label = query().trim();
    if (label === "") return;
    setQuery("");
    void crm.createTag(props.customer, label);
  };
  return (
    <ul class="crm-tag-row" aria-label={t("crm.tags.label")}>
      <For each={tagIds()}>
        {(id) => (
          <li class="crm-tag-chip">
            {crm.tag(id)?.label ?? id}
            <IconButton
              variant="ghost"
              size="icon-xs"
              label={t("crm.tags.remove", { tag: crm.tag(id)?.label ?? id })}
              onClick={() => save(tagIds().filter((item) => item !== id))}
            >
              <X aria-hidden="true" />
            </IconButton>
          </li>
        )}
      </For>
      <li>
        <Popover.Root
          placement="bottom-start"
          gutter={4}
          onOpenChange={(open: boolean) => {
            if (!open) setQuery("");
          }}
        >
          <Popover.Trigger class={buttonVariants({ variant: "ghost", size: "xs" })}>
            <Plus aria-hidden="true" />
            {t("crm.tags.add")}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="ui-popover-menu-surface crm-menu">
              <Input
                size="sm"
                aria-label={t("crm.tags.find")}
                placeholder={t("crm.tags.find")}
                value={query()}
                onValueChange={setQuery}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const match = exact();
                  if (match) toggle(match.id);
                  else create();
                }}
              />
              <div class="crm-menu-options">
                <For each={found()}>
                  {(tag) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      class="crm-menu-option"
                      aria-pressed={tagIds().includes(tag.id) ? "true" : "false"}
                      onClick={() => toggle(tag.id)}
                    >
                      <MenuMark on={tagIds().includes(tag.id)} />
                      {tag.label}
                    </Button>
                  )}
                </For>
                <Show when={query().trim() !== "" && !exact()}>
                  <Button variant="ghost" size="sm" class="crm-menu-option" onClick={create}>
                    <Plus aria-hidden="true" />
                    {t("crm.tags.create", { tag: query().trim() })}
                  </Button>
                </Show>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </li>
    </ul>
  );
}

/** The status badge. A click opens the statuses: pick one, or type a name to make a new one. */
export function StatusPicker(props: { crm: CrmViewModel; customer: CrmCustomer }) {
  const { t } = useText();
  const crm = props.crm;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const label = (id: string) => crm.statusText(id);
  const tone = (id: string) => crm.status(id)?.tone ?? "secondary";
  const found = () => crm.statuses().filter((item) => matches(query(), label(item.id)));
  const exact = () => crm.statuses().find((item) => label(item.id).toLowerCase() === query().trim().toLowerCase());
  const pick = (statusId: string) => {
    setOpen(false);
    setQuery("");
    if (statusId !== props.customer.statusId) void crm.updateCustomer(props.customer, { statusId });
  };
  const create = () => {
    const name = query().trim();
    if (name === "") return;
    setOpen(false);
    setQuery("");
    void crm.createStatus(props.customer, name);
  };
  return (
    <Popover.Root
      placement="bottom-start"
      gutter={4}
      open={open()}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger
        class="crm-status-trigger"
        aria-label={t("crm.status.change", { status: label(props.customer.statusId) })}
      >
        <Badge variant={tone(props.customer.statusId)}>{label(props.customer.statusId)}</Badge>
        <ChevronDown aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface crm-menu">
          <Input
            size="sm"
            aria-label={t("crm.status.find")}
            placeholder={t("crm.status.find")}
            value={query()}
            onValueChange={setQuery}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const [first] = found();
              const match = exact();
              if (match) pick(match.id);
              else if (first && query().trim() === "") pick(first.id);
              else create();
            }}
          />
          <div class="crm-menu-options">
            <For each={found()}>
              {(item) => (
                <Button
                  variant="ghost"
                  size="sm"
                  class="crm-menu-option"
                  aria-pressed={item.id === props.customer.statusId ? "true" : "false"}
                  onClick={() => pick(item.id)}
                >
                  <MenuMark on={item.id === props.customer.statusId} />
                  <Badge variant={item.tone}>{label(item.id)}</Badge>
                </Button>
              )}
            </For>
            <Show when={query().trim() !== "" && !exact()}>
              <Button variant="ghost" size="sm" class="crm-menu-option" onClick={create}>
                <Plus aria-hidden="true" />
                {t("crm.status.create", { status: query().trim() })}
              </Button>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Buttons that pick one view, with the number of items in each. */
export function Chips<T extends string>(props: {
  label: string;
  items: readonly { id: T; label: string }[];
  value: T;
  count: (id: T) => number;
  onChange: (id: T) => void;
}) {
  return (
    <fieldset class="file-list-filters crm-chips" aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            class="file-list-filter"
            aria-pressed={props.value === item.id ? "true" : "false"}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
            <Show when={item.id !== "all" && props.count(item.id) > 0}>
              <span class="crm-count">{props.count(item.id)}</span>
            </Show>
          </Button>
        )}
      </For>
    </fieldset>
  );
}

/** Marks open payments as paid and tells the user. A source marks its own payments, so they are left out. */
export function useMarkPaid(crm: CrmViewModel) {
  const { t } = useText();
  return async (payments: readonly CrmPayment[]) => {
    const open = payments.filter((payment) => payment.paidAt === null && payment.source === null);
    if (await crm.markPaid(open.map((payment) => payment.id)))
      toast(t("crm.payment.markedPaid", { count: open.length }));
  };
}

/**
 * The mark of a row that a payment source keeps: people and agents cannot change it. On a customer
 * (`linked`), the source sets only the id; the other fields stay editable.
 */
export function SourceMark(props: { source: CrmSourceKind; linked?: boolean }) {
  const { t } = useText();
  const name = () => t(SOURCE_KEY[props.source]);
  return (
    <Badge
      variant="outline"
      class="crm-source-mark"
      title={props.linked ? t("crm.source.linked", { source: name() }) : t("crm.source.owned", { source: name() })}
    >
      {name()}
    </Badge>
  );
}

/** The actions of one payment, in the sheet and in the drawer. A payment that a source keeps has only its mark. */
export function PaymentMenu(props: { crm: CrmViewModel; payment: CrmPayment; inPanel?: boolean }) {
  return (
    <Show when={props.payment.source} keyed fallback={<PaymentActions {...props} />}>
      {(source) => <SourceMark source={source} />}
    </Show>
  );
}

function PaymentActions(props: { crm: CrmViewModel; payment: CrmPayment; inPanel?: boolean }) {
  const { t } = useText();
  const text = useCrmText(props.crm);
  const markPaid = useMarkPaid(props.crm);
  const [deleting, setDeleting] = createSignal(false);
  const open = () => props.payment.paidAt === null;
  return (
    <>
      <DropdownMenu.Root placement="bottom-end" gutter={4}>
        <DropdownMenu.Trigger
          class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
          aria-label={t("crm.payment.actions", { invoice: text.invoice(props.payment.number) })}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <Show
              when={open()}
              fallback={
                <DropdownMenu.Item onSelect={() => void props.crm.markUnpaid(props.payment.id)}>
                  <Undo2 aria-hidden="true" />
                  {t("crm.payment.markUnpaid")}
                </DropdownMenu.Item>
              }
            >
              <DropdownMenu.Item onSelect={() => void markPaid([props.payment])}>
                <Check aria-hidden="true" />
                {t("crm.payment.markPaid")}
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Item
              onSelect={() =>
                props.crm.openForm({
                  kind: "payment",
                  customerId: props.payment.customerId,
                  paymentId: props.payment.id,
                })
              }
            >
              <Pencil aria-hidden="true" />
              {t("crm.payment.edit")}
            </DropdownMenu.Item>
            <Show when={open()}>
              <DropdownMenu.Item onSelect={() => props.crm.openForm({ kind: "split", paymentId: props.payment.id })}>
                <Split aria-hidden="true" />
                {t("crm.payment.split")}
              </DropdownMenu.Item>
            </Show>
            <Show when={!props.inPanel}>
              <DropdownMenu.Item onSelect={() => props.crm.select(props.payment.customerId)}>
                {t("crm.payment.openCustomer")}
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => setDeleting(true)}>
              <Trash2 aria-hidden="true" />
              {t("crm.payment.delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDialog
        open={deleting()}
        tone="destructive"
        title={t("crm.payment.deleteTitle", { invoice: text.invoice(props.payment.number) })}
        description={t("crm.payment.deleteBody", {
          label: props.payment.label,
          amount: text.money(props.payment.amountMinor, props.payment.currency),
        })}
        confirmLabel={t("crm.payment.delete")}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await props.crm.ok({ kind: "payment-delete", paymentId: props.payment.id });
          setDeleting(false);
        }}
      />
    </>
  );
}

/**
 * The actions of one plan in the drawer. Ending a plan removes its open payments after the end. A plan
 * that a source keeps has only its mark.
 */
export function PlanMenu(props: { crm: CrmViewModel; customer: CrmCustomer; plan: CrmPlan }) {
  return (
    <Show when={props.plan.source} keyed fallback={<PlanActions {...props} />}>
      {(source) => <SourceMark source={source} />}
    </Show>
  );
}

function PlanActions(props: { crm: CrmViewModel; customer: CrmCustomer; plan: CrmPlan }) {
  const { t } = useText();
  const ended = () => props.plan.endsOn !== null;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
        aria-label={t("crm.plan.actions", { plan: props.plan.name })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            onSelect={() => props.crm.openForm({ kind: "plan", customerId: props.customer.id, planId: props.plan.id })}
          >
            <Pencil aria-hidden="true" />
            {t("crm.plan.edit")}
          </DropdownMenu.Item>
          <Show when={!ended()}>
            <DropdownMenu.Item
              onSelect={() => void props.crm.ok({ kind: "plan-end", planId: props.plan.id, endsOn: props.crm.today() })}
            >
              <X aria-hidden="true" />
              {t("crm.plan.end")}
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Which agents can read the CRM and suggest changes. The list has a search for servers with many agents. */
export function AgentAccess(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const agents = createMemo(() =>
    [...props.crm.agents()]
      .filter((agent) => matches(query(), agent.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  return (
    <Popover.Root
      placement="bottom-end"
      gutter={6}
      onOpenChange={(open: boolean) => {
        if (!open) setQuery("");
      }}
    >
      <Popover.Trigger class={buttonVariants({ variant: "ghost", size: "xs" })}>
        {t("crm.access.button", { count: props.crm.access().length })}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface crm-access-menu">
          <Popover.Title class="crm-access-title">{t("crm.access.title")}</Popover.Title>
          <Input
            size="sm"
            type="search"
            aria-label={t("crm.access.find")}
            placeholder={t("crm.access.find")}
            value={query()}
            onValueChange={setQuery}
          />
          <div class="crm-access-list">
            <For each={agents()} fallback={<p class="crm-access-none">{t("crm.access.none")}</p>}>
              {(agent) => (
                <SwitchField
                  label={
                    <span class="crm-access-agent">
                      <AgentAvatar agent={agent} class="crm-avatar-sm" />
                      {agent.name}
                    </span>
                  }
                  checked={props.crm.access().includes(agent.id)}
                  onChange={(on: boolean) => void props.crm.setAccess(agent.id, on)}
                />
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The scrolling body of a drawer panel, with edge fades and middle-click autoscroll. */
export function SideBody(props: { children: JSX.Element }) {
  const fades = createScrollFades();
  const autoScroll = createAutoScroll();
  onCleanup(() => fades.stop());
  return (
    <div
      ref={(element: HTMLDivElement) => {
        fades.bind(element);
        autoScroll.bind(element);
      }}
      class={["crm-side-body", fades.classes()]}
      onScroll={() => fades.measure()}
    >
      {props.children}
    </div>
  );
}

/** The state of a payment as a badge: paid, late or upcoming. */
export function PayStateBadge(props: { crm: CrmViewModel; payment: CrmPayment }) {
  const { t } = useText();
  const state = () => payState(props.payment, props.crm.today());
  return <Badge variant={payVariant(state())}>{t(PAY_STATE_KEY[state()])}</Badge>;
}
