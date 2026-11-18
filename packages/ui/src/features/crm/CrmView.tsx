import type { CrmCustomer } from "@openbot/contracts/ipc";
import { buttonVariants, CreditCard, DropdownMenu, IconButton, Plug, Plus, SlidingTabs, UsersRound } from "@openbot/ui";
import { FileSearch } from "@openbot/ui/features/files/FileList";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, For, Show } from "solid-js";
import { CrmCustomerPanel } from "./CrmCustomerPanel";
import { CrmCustomers } from "./CrmCustomers";
import { CrmDialog } from "./CrmDialog";
import { CrmPayments } from "./CrmPayments";
import { ReviewButton, ReviewPanel } from "./CrmReview";
import { CRM_TABS, type CrmTab, payState } from "./crm-model";
import { type CrmForm, type CrmViewModel, type CrmViewProps, createCrmView } from "./crm-state";

const TAB_ICON = { customers: UsersRound, payments: CreditCard } satisfies Record<CrmTab, typeof UsersRound>;
const TAB_KEY = { customers: "crm.tab.customers", payments: "crm.tab.payments" } as const satisfies Record<
  CrmTab,
  string
>;

function isTab(value: string): value is CrmTab {
  return CRM_TABS.some((tab) => tab === value);
}

function NewMenu(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const items = (): { form: CrmForm; label: string }[] => [
    { form: { kind: "customer" }, label: t("crm.new.customer") },
    { form: { kind: "payment", customerId: null }, label: t("crm.new.payment") },
  ];
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger class={buttonVariants({ size: "sm" })}>
        <Plus aria-hidden="true" />
        {t("crm.new.button")}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <For each={items()}>
            {(item) => (
              <DropdownMenu.Item onSelect={() => props.crm.openForm(item.form)}>{item.label}</DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The CRM page: the customer and payment sheets, the drawer that slides over them, and the forms. */
export function CrmView(props: CrmViewProps) {
  const { t, format } = useText();
  const crm = createCrmView(props);
  createEffect(
    () => props.connectors?.requested() === true,
    (requested) => {
      if (!requested) return;
      props.connectors?.taken();
      crm.openForm({ kind: "source", source: null });
    },
  );
  const late = createMemo(() => crm.data().open.filter((payment) => payState(payment, crm.today()) === "late").length);

  // The drawer keeps its last panel while it slides out.
  const drawerOpen = () => crm.selected() !== null || crm.view.agents;
  let lastKind: "customer" | "agents" = "customer";
  let lastCustomer: CrmCustomer | undefined;
  const drawerKind = createMemo(() => {
    if (crm.view.agents) lastKind = "agents";
    else if (crm.selected() !== null) lastKind = "customer";
    return lastKind;
  });
  const drawerCustomer = createMemo(() => {
    const customer = crm.customer(crm.selected());
    if (customer) lastCustomer = customer;
    else if (crm.selected() !== null) lastCustomer = undefined;
    return drawerKind() === "customer" ? lastCustomer : undefined;
  });
  const drawerCustomerId = createMemo(() => drawerCustomer()?.id);

  return (
    <SlidingTabs.Root
      class="crm-page"
      value={crm.layout.tab}
      onChange={(value: string) => {
        if (isTab(value))
          crm.setLayout((draft) => {
            draft.tab = value;
          });
      }}
    >
      <header class="crm-top">
        <h1 class="sr-only">{t("crm.page.title")}</h1>
        <SlidingTabs.List aria-label={t("crm.tabs.label")}>
          <For each={CRM_TABS}>
            {(tab) => {
              const Icon = TAB_ICON[tab];
              return (
                <SlidingTabs.Trigger value={tab}>
                  <Icon class="crm-tab-icon" aria-hidden="true" />
                  {t(TAB_KEY[tab])}
                  <Show when={tab === "payments" && late() > 0}>
                    <span class="crm-tab-count" data-late="">
                      {format.number(late())}
                    </span>
                  </Show>
                </SlidingTabs.Trigger>
              );
            }}
          </For>
        </SlidingTabs.List>
        <div class="crm-top-tools">
          <FileSearch
            class="crm-search"
            label={t("crm.search")}
            value={crm.view.query}
            onChange={(query) =>
              crm.setView((draft) => {
                draft.query = query;
              })
            }
          />
          {/* The CRM can be in the More menu, which has no right-click menu, so the page opens its connectors too. */}
          <IconButton
            variant="ghost"
            label={t("crm.connectors.title")}
            onClick={() => crm.openForm({ kind: "source", source: null })}
          >
            <Plug aria-hidden="true" />
          </IconButton>
          <ReviewButton crm={crm} />
          <NewMenu crm={crm} />
        </div>
      </header>
      <div class="crm-body">
        <SlidingTabs.ContentSlot class="crm-views">
          <SlidingTabs.Content value="customers" class="crm-view">
            <CrmCustomers crm={crm} />
          </SlidingTabs.Content>
          <SlidingTabs.Content value="payments" class="crm-view">
            <CrmPayments crm={crm} />
          </SlidingTabs.Content>
        </SlidingTabs.ContentSlot>
        <div class="crm-drawer" data-open={drawerOpen() ? "" : undefined} inert={drawerOpen() ? undefined : true}>
          {/* A new read of the host gives a new customer object; the panel stays, so it keeps its scroll position. */}
          <Show when={drawerCustomerId()} keyed>
            {(id) => (
              <Show when={drawerCustomer()?.id === id ? drawerCustomer() : undefined}>
                {(customer) => <CrmCustomerPanel crm={crm} customer={customer()} />}
              </Show>
            )}
          </Show>
          <Show when={drawerKind() === "agents"}>
            <ReviewPanel crm={crm} />
          </Show>
        </div>
      </div>
      <Show when={crm.view.form} keyed>
        {(form) => <CrmDialog crm={crm} form={form} />}
      </Show>
    </SlidingTabs.Root>
  );
}
