import {
  CRM_LIMITS,
  type CrmCustomer,
  type CrmCustomerPatch,
  type CrmMethod,
  type CrmPlan,
  type CrmTextField,
} from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  buttonVariants,
  Check,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  ChoiceField,
  Glance,
  Logo,
  NameField,
  Owner,
  OwnerSelect,
  PanelSection,
  PaymentMenu,
  PlanMenu,
  PrivateMark,
  SideBody,
  SourceMark,
  StatusPicker,
  TagPicker,
  TextField,
  useMarkPaid,
} from "./CrmParts";
import { PendingProposal } from "./CrmReview";
import {
  activePlans,
  CRM_CURRENCIES,
  customerSummary,
  daysBetween,
  daysLate,
  EVERY_KEY,
  FIELD_KEY,
  formatDay,
  formatDayWithYear,
  localDateOf,
  METHOD_KEY,
  timeAgo,
} from "./crm-model";
import type { CrmViewModel } from "./crm-state";
import { useCrmText } from "./crm-text";

type MethodChoice = CrmMethod | "none";

const METHOD_CHOICES: MethodChoice[] = ["stripe", "transfer", "crypto", "paypal", "cash", "none"];

function PlanRow(props: { crm: CrmViewModel; customer: CrmCustomer; plan: CrmPlan }) {
  const { t, format } = useText();
  const text = useCrmText(props.crm);
  const term = () => {
    const plan = props.plan;
    const every = t(EVERY_KEY[plan.every]);
    if (plan.every === "once") return t("crm.plan.termOnce", { date: formatDayWithYear(format, plan.startsOn) });
    if (plan.endsOn !== null) return t("crm.plan.termEnds", { every, date: formatDayWithYear(format, plan.endsOn) });
    return daysBetween(props.crm.today(), plan.startsOn) > 0
      ? t("crm.plan.termFrom", { every, date: formatDayWithYear(format, plan.startsOn) })
      : t("crm.plan.termSince", { every, date: formatDayWithYear(format, plan.startsOn) });
  };
  return (
    <li class="crm-pay-row">
      <span class="crm-name-stack">
        <span>{props.plan.name}</span>
        <span class="crm-muted">{term()}</span>
      </span>
      <span class="crm-amount">{text.money(props.plan.amountMinor, props.customer.currency)}</span>
      <PlanMenu crm={props.crm} customer={props.customer} plan={props.plan} />
    </li>
  );
}

export function CrmCustomerPanel(props: { crm: CrmViewModel; customer: CrmCustomer }) {
  const { t, format, locale } = useText();
  const crm = props.crm;
  const text = useCrmText(crm);
  const markPaid = useMarkPaid(crm);
  const [deleting, setDeleting] = createSignal(false);
  const id = () => props.customer.id;
  const summary = createMemo(() => customerSummary(crm.paymentsOf(id()), crm.today()));
  const drawer = () => crm.drawer();
  const pending = () => crm.proposals().filter((proposal) => proposal.customerId === id());
  const plans = () =>
    [...props.customer.plans].sort((a, b) => {
      const active = activePlans(props.customer, crm.today());
      return Number(active.includes(b)) - Number(active.includes(a)) || b.startsOn.localeCompare(a.startsOn);
    });
  const currencyLocked = () =>
    props.customer.plans.length > 0 || props.customer.openMinor > 0 || props.customer.paidMinor > 0;
  const currencies = createMemo(() => {
    const list: string[] = [...CRM_CURRENCIES];
    return list.includes(props.customer.currency) ? list : [props.customer.currency, ...list];
  });
  const money = (minor: number) => text.money(minor, props.customer.currency);
  const update = (patch: CrmCustomerPatch) => void crm.updateCustomer(props.customer, patch);
  const saveField = (field: CrmTextField) => (value: string) => {
    const patch: CrmCustomerPatch = {};
    patch[field] = value;
    update(patch);
  };
  const field = (name: CrmTextField, options: { type?: "email" | "tel" | "url"; multiline?: boolean } = {}) => (
    <TextField
      label={t(FIELD_KEY[name])}
      mark={<PrivateMark crm={crm} field={name} />}
      value={props.customer[name]}
      type={options.type}
      multiline={options.multiline}
      maxLength={name === "notes" ? CRM_LIMITS.notes : CRM_LIMITS.text}
      onSave={saveField(name)}
    />
  );

  const staticField = (name: CrmTextField) => (
    <div class="crm-field">
      <dt>{t(FIELD_KEY[name])}</dt>
      <dd class="crm-static">{props.customer[name]}</dd>
    </div>
  );

  return (
    <aside class="crm-side crm-customer" aria-label={props.customer.name}>
      <header class="crm-side-head">
        <Show
          when={props.customer.statusId === "customer"}
          fallback={
            <Badge variant={crm.status(props.customer.statusId)?.tone ?? "secondary"}>
              {crm.statusText(props.customer.statusId)}
            </Badge>
          }
        >
          <Show
            when={props.customer.lateMinor > 0}
            fallback={<Badge variant="success-light">{t("crm.customer.paidUp")}</Badge>}
          >
            <Badge variant="destructive-light">{t("crm.customer.notPaid")}</Badge>
          </Show>
        </Show>
        <span class="crm-spacer" />
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger
            class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={t("crm.customer.actions", { name: props.customer.name })}
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                {t("crm.customer.delete")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <ConfirmDialog
          open={deleting()}
          tone="destructive"
          title={t("crm.customer.deleteTitle", { name: props.customer.name })}
          description={t("crm.customer.deleteBody")}
          confirmLabel={t("crm.customer.delete")}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            const deleted = await crm.ok({ kind: "customer-delete", customerId: props.customer.id });
            setDeleting(false);
            if (deleted) crm.closePanel();
          }}
        />
        <IconButton label={t("crm.panel.close")} variant="ghost" size="icon-sm" onClick={() => crm.closePanel()}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <SideBody>
        <div class="crm-identity">
          <div class="crm-name-cell">
            <Logo name={props.customer.name} />
            <NameField value={props.customer.name} onSave={(name) => update({ name })} />
            <PrivateMark crm={crm} field="name" />
            <Show when={props.customer.source} keyed>
              {(source) => <SourceMark source={source} linked />}
            </Show>
          </div>
          <TagPicker crm={crm} customer={props.customer} />
        </div>

        <For each={pending()}>{(proposal) => <PendingProposal crm={crm} proposal={proposal} />}</For>

        <div class="crm-glance">
          <Show when={summary().late[0]} keyed>
            {(oldest) => (
              <Glance
                label={t("crm.customer.notPaid")}
                value={money(props.customer.lateMinor)}
                detail={text.due(oldest.dueOn)}
                late
              />
            )}
          </Show>
          <Show
            when={summary().upcoming[0]}
            keyed
            fallback={<Glance label={t("crm.customer.nextPayment")} value={t("crm.customer.noNextPayment")} />}
          >
            {(next) => (
              <Glance
                label={t("crm.customer.nextPayment")}
                value={money(next.amountMinor)}
                detail={text.due(next.dueOn)}
              />
            )}
          </Show>
          <Glance
            label={t("crm.customer.paidSoFar")}
            value={money(props.customer.paidMinor)}
            detail={
              props.customer.lastPaidAt
                ? t("crm.customer.lastPaid", { date: formatDay(format, localDateOf(props.customer.lastPaidAt)) })
                : undefined
            }
          />
        </div>

        <Show when={summary().late.length > 0}>
          <PanelSection title={t("crm.customer.notPaid")}>
            <ul class="crm-pay-list">
              <For each={summary().late}>
                {(payment) => (
                  <li class="crm-pay-row">
                    <span class="crm-name-stack">
                      <span>{payment.label}</span>
                      <span class="crm-late">{text.due(payment.dueOn)}</span>
                    </span>
                    <span class="crm-amount">{money(payment.amountMinor)}</span>
                    <span class="crm-row-actions">
                      <Show when={payment.source === null}>
                        <Button variant="outline" size="xs" onClick={() => void markPaid([payment])}>
                          <Check aria-hidden="true" />
                          {t("crm.payment.paid")}
                        </Button>
                      </Show>
                      <PaymentMenu crm={crm} payment={payment} inPanel />
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </PanelSection>
        </Show>

        <PanelSection
          title={t("crm.customer.plans")}
          action={
            <Button variant="ghost" size="xs" onClick={() => crm.openForm({ kind: "plan", customerId: id() })}>
              <Plus aria-hidden="true" />
              {t("crm.customer.addPlan")}
            </Button>
          }
        >
          <Show when={props.customer.plans.length > 0} fallback={<p class="crm-muted">{t("crm.customer.noPlans")}</p>}>
            <ul class="crm-pay-list">
              <For each={plans()}>{(plan) => <PlanRow crm={crm} customer={props.customer} plan={plan} />}</For>
            </ul>
          </Show>
        </PanelSection>

        <PanelSection title={t("crm.customer.contact")}>
          <dl class="crm-fields">
            {field("contactName")}
            {field("contactEmail", { type: "email" })}
            {field("phone", { type: "tel" })}
          </dl>
        </PanelSection>

        <PanelSection
          title={t("crm.customer.upcoming")}
          action={
            <Button variant="ghost" size="xs" onClick={() => crm.openForm({ kind: "payment", customerId: id() })}>
              <Plus aria-hidden="true" />
              {t("crm.customer.addPayment")}
            </Button>
          }
        >
          <Show when={summary().upcoming.length > 0} fallback={<p class="crm-muted">{t("crm.customer.noUpcoming")}</p>}>
            <ul class="crm-pay-list">
              <For each={summary().upcoming}>
                {(payment) => (
                  <li class="crm-pay-row">
                    <span class="crm-name-stack">
                      <span>{payment.label}</span>
                      <span class="crm-when" data-soon={daysBetween(crm.today(), payment.dueOn) <= 3 ? "" : undefined}>
                        {t("crm.customer.dueOn", {
                          date: formatDay(format, payment.dueOn),
                          due: text.due(payment.dueOn),
                        })}
                      </span>
                    </span>
                    <span class="crm-amount">{money(payment.amountMinor)}</span>
                    <PaymentMenu crm={crm} payment={payment} inPanel />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </PanelSection>

        <Show when={(drawer()?.paid?.length ?? 0) > 0}>
          <PanelSection title={t("crm.customer.history")}>
            <ul class="crm-pay-list">
              <For each={summary().paid}>
                {(payment) => (
                  <li class="crm-pay-row">
                    <span class="crm-name-stack">
                      <span>{payment.label}</span>
                      <span class="crm-muted">
                        {t("crm.customer.paidOn", {
                          date: formatDay(format, localDateOf(payment.paidAt ?? payment.dueOn)),
                        })}
                      </span>
                    </span>
                    <Badge variant={daysLate(payment, crm.today()) === 0 ? "success-light" : "warning-light"}>
                      {text.timing(payment)}
                    </Badge>
                    <span class="crm-amount">{money(payment.amountMinor)}</span>
                    <PaymentMenu crm={crm} payment={payment} inPanel />
                  </li>
                )}
              </For>
            </ul>
          </PanelSection>
        </Show>

        <PanelSection title={t("crm.customer.billing")}>
          <dl class="crm-fields">
            <ChoiceField
              label={t("crm.field.method")}
              options={METHOD_CHOICES}
              value={props.customer.method ?? "none"}
              text={(value) => (value === "none" ? t("crm.method.none") : t(METHOD_KEY[value]))}
              onChange={(value) => update({ method: value === "none" ? null : value })}
            />
            <Show when={props.customer.method === "stripe" || props.customer.stripeCustomerId !== ""}>
              {/* The source links the customer by this id, so it does not change while it is linked. */}
              <Show when={props.customer.source === null} fallback={staticField("stripeCustomerId")}>
                {field("stripeCustomerId")}
              </Show>
            </Show>
            <TextField
              label={t(FIELD_KEY.billingEmail)}
              mark={<PrivateMark crm={crm} field="billingEmail" />}
              type="email"
              value={props.customer.billingEmail}
              display={props.customer.billingEmail || props.customer.contactEmail}
              maxLength={CRM_LIMITS.text}
              onSave={saveField("billingEmail")}
            />
            {field("taxId")}
            {field("address")}
            <Show
              when={!currencyLocked()}
              fallback={
                <div class="crm-field">
                  <dt>{t("crm.field.currency")}</dt>
                  <dd class="crm-static">{props.customer.currency}</dd>
                </div>
              }
            >
              <ChoiceField
                label={t("crm.field.currency")}
                options={currencies()}
                value={props.customer.currency}
                text={(code) => code}
                onChange={(currency) => update({ currency })}
              />
            </Show>
          </dl>
        </PanelSection>

        <PanelSection title={t("crm.customer.details")}>
          <dl class="crm-fields">
            <div class="crm-field">
              <dt>{t("crm.field.status")}</dt>
              <dd>
                <StatusPicker crm={crm} customer={props.customer} />
              </dd>
            </div>
            {field("domain", { type: "url" })}
            <div class="crm-field">
              <dt>{t("crm.field.owner")}</dt>
              <dd>
                <OwnerSelect
                  crm={crm}
                  value={props.customer.ownerAgentId}
                  label={t("crm.field.owner")}
                  onChange={(ownerAgentId) => update({ ownerAgentId })}
                />
              </dd>
            </div>
            <div class="crm-field">
              <dt>{t("crm.customer.since")}</dt>
              <dd class="crm-static">
                {format.date(new Date(props.customer.createdAt), { month: "long", year: "numeric" })}
              </dd>
            </div>
            {field("notes", { multiline: true })}
          </dl>
        </PanelSection>

        <PanelSection title={t("crm.customer.activity")}>
          <Show when={drawer()?.activity} keyed fallback={<p class="crm-muted">{t("crm.customer.loading")}</p>}>
            {(activity) => (
              <ol class="crm-timeline">
                <For each={activity}>
                  {(entry) => (
                    <li class="crm-entry">
                      <Show
                        when={entry.actor.kind === "agent"}
                        fallback={
                          <span class="crm-owner-none" aria-hidden="true">
                            <Show when={entry.actor.kind === "source"} fallback={<UserRound />}>
                              <RefreshCw />
                            </Show>
                          </span>
                        }
                      >
                        <Owner crm={crm} id={entry.actor.id} />
                      </Show>
                      <div class="crm-entry-body">
                        <p>{text.activity(entry)}</p>
                        <span class="crm-entry-meta">
                          <Show when={entry.proposedBy} keyed fallback={timeAgo(locale(), entry.createdAt)}>
                            {(agentId) =>
                              t("crm.activity.suggestedBy", {
                                time: timeAgo(locale(), entry.createdAt),
                                agent: crm.agentName(agentId),
                              })
                            }
                          </Show>
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            )}
          </Show>
        </PanelSection>
      </SideBody>
    </aside>
  );
}
