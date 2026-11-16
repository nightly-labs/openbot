import {
  CRM_EVERY,
  CRM_LIMITS,
  type CrmCustomer,
  type CrmEvery,
  type CrmMethod,
  type CrmPayment,
  type CrmPaymentPatch,
  type CrmPlan,
  type CrmPlanPatch,
} from "@openbot/contracts/ipc";
import { Button, Checkbox, Dialog, Field, IconButton, Input, Plus, SearchSelect, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, createUniqueId, For, Show } from "solid-js";
import { ChoiceSelect, LabelledControl, OwnerSelect } from "./CrmParts";
import { CrmSourceDialog } from "./CrmSourceDialog";
import { addDays, CRM_CURRENCIES, EVERY_KEY, FIELD_KEY, METHOD_KEY, moneyInput, parseMoney } from "./crm-model";
import type { CrmForm, CrmViewModel } from "./crm-state";
import { useCrmText } from "./crm-text";

type MethodChoice = CrmMethod | "none";
const METHOD_CHOICES: MethodChoice[] = ["stripe", "transfer", "crypto", "paypal", "cash", "none"];
const EVERY_CHOICES: CrmEvery[] = [...CRM_EVERY];
const FALLBACK_CURRENCY = "EUR";
/** A new payment is due this many days after today. */
const DUE_AFTER_DAYS = 14;
/** Each new part of a split is due this many days after the part before it. */
const SPLIT_STEP_DAYS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function methodOf(choice: MethodChoice): CrmMethod | null {
  return choice === "none" ? null : choice;
}

function useMethodText() {
  const { t } = useText();
  return (value: MethodChoice) => (value === "none" ? t("crm.method.none") : t(METHOD_KEY[value]));
}

/** The dialog frame. The submit button is off while the form is not valid or while it saves. */
function FormDialog(props: {
  crm: CrmViewModel;
  title: string;
  submit: string;
  valid: boolean;
  onSubmit: () => Promise<boolean>;
  children: JSX.Element;
}) {
  const { t } = useText();
  const [busy, setBusy] = createSignal(false);
  const submit = async () => {
    if (!props.valid || busy()) return;
    setBusy(true);
    try {
      if (await props.onSubmit()) props.crm.closeForm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open: boolean) => !open && props.crm.closeForm()}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-confirm-dialog crm-form">
            <form
              class="crm-form-body"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Dialog.Title class="crm-form-title">{props.title}</Dialog.Title>
              <div class="crm-form-grid">{props.children}</div>
              <div class="crm-form-actions">
                <Button type="button" variant="ghost" onClick={() => props.crm.closeForm()}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!props.valid || busy()}>
                  {props.submit}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The currency that most customers use, for a new customer. */
function usualCurrency(customers: readonly CrmCustomer[]): string {
  const counts = new Map<string, number>();
  for (const customer of customers) counts.set(customer.currency, (counts.get(customer.currency) ?? 0) + 1);
  let best = FALLBACK_CURRENCY;
  let most = 0;
  for (const [currency, count] of counts) {
    if (count > most) {
      best = currency;
      most = count;
    }
  }
  return best;
}

interface CustomerDraft {
  name: string;
  statusId: string;
  ownerAgentId: string | null;
  method: MethodChoice;
  currency: string;
  domain: string;
  contactName: string;
  contactEmail: string;
}

function CustomerForm(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const crm = props.crm;
  const methodText = useMethodText();
  const statusIds = crm.statuses().map((status) => status.id);
  const firstStatus = statusIds.includes("customer") ? "customer" : (statusIds[0] ?? "customer");
  const currency = usualCurrency(crm.customers());
  const known: string[] = [...CRM_CURRENCIES];
  const currencies = known.includes(currency) ? known : [currency, ...known];
  const [form, setForm] = createStore<CustomerDraft>({
    name: "",
    statusId: firstStatus,
    ownerAgentId: null,
    method: "none",
    currency,
    domain: "",
    contactName: "",
    contactEmail: "",
  });
  const valid = () => form.name.trim() !== "";
  return (
    <FormDialog
      crm={crm}
      title={t("crm.form.customerTitle")}
      submit={t("crm.form.addCustomer")}
      valid={valid()}
      onSubmit={async () => {
        const id = await crm.created({
          kind: "customer-create",
          customer: {
            name: form.name.trim(),
            statusId: form.statusId,
            ownerAgentId: form.ownerAgentId,
            method: methodOf(form.method),
            currency: form.currency,
            domain: form.domain.trim(),
            contactName: form.contactName.trim(),
            contactEmail: form.contactEmail.trim(),
          },
        });
        if (id === null) return false;
        crm.select(id);
        return true;
      }}
    >
      <Field label={t(FIELD_KEY.name)} required class="crm-wide">
        <Input
          value={form.name}
          maxlength={CRM_LIMITS.name}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.name = value;
            })
          }
        />
      </Field>
      <LabelledControl label={t("crm.column.status")}>
        {(labelId) => (
          <ChoiceSelect
            options={statusIds}
            value={form.statusId}
            text={(id) => crm.statusText(id)}
            onChange={(id) =>
              setForm((draft) => {
                draft.statusId = id;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
      <LabelledControl label={t("crm.column.owner")}>
        {(labelId) => (
          <OwnerSelect
            crm={crm}
            value={form.ownerAgentId}
            onChange={(id) =>
              setForm((draft) => {
                draft.ownerAgentId = id;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
      <LabelledControl label={t("crm.field.method")}>
        {(labelId) => (
          <ChoiceSelect
            options={METHOD_CHOICES}
            value={form.method}
            text={methodText}
            onChange={(method) =>
              setForm((draft) => {
                draft.method = method;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
      <LabelledControl label={t("crm.field.currency")}>
        {(labelId) => (
          <ChoiceSelect
            options={currencies}
            value={form.currency}
            text={(code) => code}
            onChange={(code) =>
              setForm((draft) => {
                draft.currency = code;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
      <Field label={t(FIELD_KEY.domain)} class="crm-wide">
        <Input
          value={form.domain}
          maxlength={CRM_LIMITS.text}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.domain = value;
            })
          }
        />
      </Field>
      <Field label={t(FIELD_KEY.contactName)}>
        <Input
          value={form.contactName}
          maxlength={CRM_LIMITS.text}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.contactName = value;
            })
          }
        />
      </Field>
      <Field label={t(FIELD_KEY.contactEmail)}>
        <Input
          type="email"
          value={form.contactEmail}
          maxlength={CRM_LIMITS.text}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.contactEmail = value;
            })
          }
        />
      </Field>
    </FormDialog>
  );
}

function AmountField(props: { label: string; value: string; currency: string; onChange: (value: string) => void }) {
  return (
    <Field label={`${props.label} (${props.currency})`} required>
      <Input inputmode="decimal" value={props.value} onValueChange={props.onChange} />
    </Field>
  );
}

interface PaymentDraft {
  customerId: string;
  label: string;
  amount: string;
  dueOn: string;
  method: MethodChoice;
  paid: boolean;
  paidOn: string;
}

function PaymentForm(props: { crm: CrmViewModel; customerId: string | null; payment: CrmPayment | undefined }) {
  const { t } = useText();
  const crm = props.crm;
  const methodText = useMethodText();
  const editing = props.payment;
  const paidId = createUniqueId();
  // The picker keeps one options array while the dialog is open.
  const customerIds = [...crm.customers()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => item.id);
  const firstCustomer = editing?.customerId ?? props.customerId ?? customerIds[0] ?? "";
  const [form, setForm] = createStore<PaymentDraft>({
    customerId: firstCustomer,
    label: editing?.label ?? "",
    amount: editing ? moneyInput(editing.amountMinor, editing.currency) : "",
    dueOn: editing?.dueOn ?? addDays(crm.today(), DUE_AFTER_DAYS),
    method: (editing ? editing.method : crm.customer(firstCustomer)?.method) ?? "none",
    paid: false,
    paidOn: crm.today(),
  });
  const customer = () => crm.customer(form.customerId);
  const currency = () => editing?.currency ?? customer()?.currency ?? FALLBACK_CURRENCY;
  const amountMinor = () => parseMoney(form.amount, currency());
  const valid = () =>
    customer() !== undefined &&
    form.label.trim() !== "" &&
    amountMinor() !== null &&
    DATE.test(form.dueOn) &&
    (!form.paid || DATE.test(form.paidOn));
  const title = () => (editing ? t("crm.form.paymentEditTitle") : t("crm.form.paymentTitle"));
  const submit = () => {
    if (editing) return t("common.save");
    return form.paid ? t("crm.form.recordPayment") : t("crm.form.addPayment");
  };

  const save = async () => {
    const amount = amountMinor();
    if (amount === null) return false;
    if (editing) {
      const patch: CrmPaymentPatch = {};
      if (form.label.trim() !== editing.label) patch.label = form.label.trim();
      if (amount !== editing.amountMinor) patch.amountMinor = amount;
      if (form.dueOn !== editing.dueOn) patch.dueOn = form.dueOn;
      if (methodOf(form.method) !== editing.method) patch.method = methodOf(form.method);
      if (Object.keys(patch).length === 0) return true;
      return crm.ok({ kind: "payment-update", paymentId: editing.id, patch });
    }
    // A paid payment keeps the local day that the user typed, at noon so that no time zone moves it.
    const paidAt = form.paid ? new Date(`${form.paidOn}T12:00:00`).toISOString() : null;
    const id = await crm.created({
      kind: "payment-create",
      payment: {
        customerId: form.customerId,
        label: form.label.trim(),
        amountMinor: amount,
        dueOn: form.paid ? form.paidOn : form.dueOn,
        method: methodOf(form.method),
        paidAt,
      },
    });
    return id !== null;
  };

  return (
    <FormDialog crm={crm} title={title()} submit={submit()} valid={valid()} onSubmit={save}>
      <Show when={!editing && props.customerId === null}>
        <LabelledControl label={t("crm.form.customer")} wide>
          {(labelId) => (
            <SearchSelect<string>
              options={customerIds}
              value={form.customerId === "" ? null : form.customerId}
              onChange={(id) => {
                if (id === form.customerId) return;
                setForm((draft) => {
                  draft.customerId = id;
                  draft.method = crm.customer(id)?.method ?? "none";
                });
              }}
              label={(id) => crm.customer(id)?.name ?? id}
              size="sm"
              class="crm-select"
              aria-labelledby={labelId}
            />
          )}
        </LabelledControl>
      </Show>
      <Field label={t("crm.form.for")} required class="crm-wide">
        <Input
          value={form.label}
          maxlength={CRM_LIMITS.label}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.label = value;
            })
          }
        />
      </Field>
      <AmountField
        label={t("crm.form.amount")}
        value={form.amount}
        currency={currency()}
        onChange={(value) =>
          setForm((draft) => {
            draft.amount = value;
          })
        }
      />
      <Show when={!editing}>
        <label class="crm-check" for={paidId}>
          <Checkbox
            id={paidId}
            checked={form.paid}
            onChange={(event) => {
              const paid = event.currentTarget.checked;
              setForm((draft) => {
                draft.paid = paid;
              });
            }}
          />
          {t("crm.form.paid")}
        </label>
      </Show>
      <Show
        when={form.paid}
        fallback={
          <Field label={t("crm.form.dueOn")} required>
            <Input
              type="date"
              value={form.dueOn}
              onValueChange={(value) =>
                setForm((draft) => {
                  draft.dueOn = value;
                })
              }
            />
          </Field>
        }
      >
        <Field label={t("crm.form.paidOn")} required>
          <Input
            type="date"
            value={form.paidOn}
            onValueChange={(value) =>
              setForm((draft) => {
                draft.paidOn = value;
              })
            }
          />
        </Field>
      </Show>
      <LabelledControl label={form.paid ? t("crm.form.paidBy") : t("crm.field.method")}>
        {(labelId) => (
          <ChoiceSelect
            options={METHOD_CHOICES}
            value={form.method}
            text={methodText}
            onChange={(method) =>
              setForm((draft) => {
                draft.method = method;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
    </FormDialog>
  );
}

interface PlanDraft {
  name: string;
  amount: string;
  every: CrmEvery;
  startsOn: string;
}

function PlanForm(props: { crm: CrmViewModel; customer: CrmCustomer; plan: CrmPlan | undefined }) {
  const { t } = useText();
  const crm = props.crm;
  const editing = props.plan;
  const currency = props.customer.currency;
  const [form, setForm] = createStore<PlanDraft>({
    name: editing?.name ?? "",
    amount: editing ? moneyInput(editing.amountMinor, currency) : "",
    every: editing?.every ?? "month",
    startsOn: editing?.startsOn ?? crm.today(),
  });
  const amountMinor = () => parseMoney(form.amount, currency);
  const valid = () => form.name.trim() !== "" && amountMinor() !== null && DATE.test(form.startsOn);

  const save = async () => {
    const amount = amountMinor();
    if (amount === null) return false;
    if (editing) {
      const patch: CrmPlanPatch = {};
      if (form.name.trim() !== editing.name) patch.name = form.name.trim();
      if (amount !== editing.amountMinor) patch.amountMinor = amount;
      if (form.every !== editing.every) patch.every = form.every;
      if (Object.keys(patch).length === 0) return true;
      return crm.ok({ kind: "plan-update", planId: editing.id, patch });
    }
    const id = await crm.created({
      kind: "plan-create",
      plan: {
        customerId: props.customer.id,
        name: form.name.trim(),
        amountMinor: amount,
        every: form.every,
        startsOn: form.startsOn,
      },
    });
    return id !== null;
  };

  return (
    <FormDialog
      crm={crm}
      title={editing ? t("crm.form.planEditTitle") : t("crm.form.planTitle", { customer: props.customer.name })}
      submit={editing ? t("common.save") : t("crm.form.addPlan")}
      valid={valid()}
      onSubmit={save}
    >
      <Field label={t("crm.form.planName")} required class="crm-wide">
        <Input
          value={form.name}
          maxlength={CRM_LIMITS.label}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.name = value;
            })
          }
        />
      </Field>
      <AmountField
        label={t("crm.form.amount")}
        value={form.amount}
        currency={currency}
        onChange={(value) =>
          setForm((draft) => {
            draft.amount = value;
          })
        }
      />
      <LabelledControl label={t("crm.form.every")}>
        {(labelId) => (
          <ChoiceSelect
            options={EVERY_CHOICES}
            value={form.every}
            text={(every) => t(EVERY_KEY[every])}
            onChange={(every) =>
              setForm((draft) => {
                draft.every = every;
              })
            }
            labelledBy={labelId}
          />
        )}
      </LabelledControl>
      <Show when={!editing}>
        <Field label={t("crm.form.startsOn")} required>
          <Input
            type="date"
            value={form.startsOn}
            onValueChange={(value) =>
              setForm((draft) => {
                draft.startsOn = value;
              })
            }
          />
        </Field>
      </Show>
    </FormDialog>
  );
}

interface SplitPart {
  amount: string;
  dueOn: string;
}

/** Splits the amount into equal parts. The last part takes the minor units that are left. */
function evenParts(payment: CrmPayment, count: number): SplitPart[] {
  const share = Math.floor(payment.amountMinor / count);
  return Array.from({ length: count }, (_, index) => ({
    amount: moneyInput(index === count - 1 ? payment.amountMinor - share * (count - 1) : share, payment.currency),
    dueOn: addDays(payment.dueOn, index * SPLIT_STEP_DAYS),
  }));
}

function SplitForm(props: { crm: CrmViewModel; payment: CrmPayment }) {
  const { t } = useText();
  const crm = props.crm;
  const text = useCrmText(crm);
  const payment = props.payment;
  const [parts, setParts] = createStore<{ list: SplitPart[] }>({ list: evenParts(payment, 2) });
  const amounts = createMemo(() => parts.list.map((part) => parseMoney(part.amount, payment.currency)));
  const sum = () => amounts().reduce<number>((total, amount) => total + (amount ?? 0), 0);
  const partsValid = () =>
    amounts().every((amount) => amount !== null && amount > 0) && parts.list.every((part) => DATE.test(part.dueOn));
  const valid = () => parts.list.length >= 2 && partsValid() && sum() === payment.amountMinor;
  const sumError = () =>
    partsValid() && sum() !== payment.amountMinor
      ? t("crm.form.splitSum", {
          sum: text.money(sum(), payment.currency),
          amount: text.money(payment.amountMinor, payment.currency),
        })
      : undefined;

  return (
    <FormDialog
      crm={crm}
      title={t("crm.form.splitTitle", { invoice: text.invoice(payment.number) })}
      submit={t("crm.form.split")}
      valid={valid()}
      onSubmit={() =>
        crm.ok({
          kind: "payment-split",
          paymentId: payment.id,
          parts: parts.list.map((part, index) => ({ amountMinor: amounts()[index] ?? 0, dueOn: part.dueOn })),
        })
      }
    >
      <ol class="crm-split crm-wide">
        <For each={parts.list} keyed={false}>
          {(part, index) => (
            <li class="crm-split-part">
              <Field label={t("crm.form.partAmount", { number: index + 1, currency: payment.currency })}>
                <Input
                  inputmode="decimal"
                  value={part().amount}
                  onValueChange={(value) =>
                    setParts((draft) => {
                      const item = draft.list[index];
                      if (item) item.amount = value;
                    })
                  }
                />
              </Field>
              <Field label={t("crm.form.partDue", { number: index + 1 })}>
                <Input
                  type="date"
                  value={part().dueOn}
                  onValueChange={(value) =>
                    setParts((draft) => {
                      const item = draft.list[index];
                      if (item) item.dueOn = value;
                    })
                  }
                />
              </Field>
              <IconButton
                label={t("crm.form.removePart", { number: index + 1 })}
                variant="ghost"
                size="icon-sm"
                disabled={parts.list.length <= 2}
                onClick={() =>
                  setParts((draft) => {
                    draft.list.splice(index, 1);
                  })
                }
              >
                <X aria-hidden="true" />
              </IconButton>
            </li>
          )}
        </For>
      </ol>
      <Show when={sumError()} keyed>
        {(message) => (
          <p class="ui-field-error crm-wide" role="alert">
            {message}
          </p>
        )}
      </Show>
      <div class="crm-wide crm-split-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={parts.list.length >= CRM_LIMITS.splitParts}
          onClick={() =>
            setParts((draft) => {
              draft.list = evenParts(payment, draft.list.length + 1);
            })
          }
        >
          <Plus aria-hidden="true" />
          {t("crm.form.addPart")}
        </Button>
      </div>
    </FormDialog>
  );
}

/** The dialog for a new or changed customer, payment or plan, a split of a payment, and a payment source. */
export function CrmDialog(props: { crm: CrmViewModel; form: CrmForm }) {
  const crm = props.crm;
  const form = props.form;
  switch (form.kind) {
    case "customer":
      return <CustomerForm crm={crm} />;
    case "payment":
      return (
        <PaymentForm
          crm={crm}
          customerId={form.customerId}
          payment={form.paymentId === undefined ? undefined : crm.payment(form.paymentId)}
        />
      );
    case "plan": {
      const customer = crm.customer(form.customerId);
      if (!customer) return null;
      const plan = form.planId === undefined ? undefined : customer.plans.find((item) => item.id === form.planId);
      return <PlanForm crm={crm} customer={customer} plan={plan} />;
    }
    case "split": {
      const payment = crm.payment(form.paymentId);
      return payment && payment.paidAt === null ? <SplitForm crm={crm} payment={payment} /> : null;
    }
    case "source":
      return <CrmSourceDialog crm={crm} kind={form.source} />;
  }
}
