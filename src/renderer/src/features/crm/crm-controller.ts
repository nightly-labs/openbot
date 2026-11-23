import type { CrmApplyResult, CrmChange, CrmPaymentPageInput } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { type CrmLayout, defaultCrmLayout, readCrmLayout, SOURCE_KEY_PAGE } from "@openbot/ui/features/crm/crm-model";
import type { CrmData, CrmDrawerData, CrmViewProps } from "@openbot/ui/features/crm/crm-state";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, onCleanup, reconcile } from "solid-js";
import type { CrmHost } from "./crm-port";

const LAYOUT_KEY = "openbot:crm-layout:";
const CHANGE_DELAY_MS = 200;

function readLayout(serverId: string): CrmLayout {
  try {
    const saved = window.localStorage.getItem(LAYOUT_KEY + serverId);
    return saved === null ? defaultCrmLayout() : readCrmLayout(JSON.parse(saved));
  } catch {
    return defaultCrmLayout();
  }
}

function writeLayout(serverId: string, layout: CrmLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY + serverId, JSON.stringify(layout));
  } catch {}
}

async function allPages<Page, Item, Cursor>(
  read: (after: Cursor | undefined) => Promise<Page>,
  items: (page: Page) => readonly Item[],
  next: (page: Page) => Cursor | null,
): Promise<Item[]> {
  const list: Item[] = [];
  let after: Cursor | undefined;
  for (;;) {
    const page = await read(after);
    list.push(...items(page));
    const cursor = next(page);
    if (cursor === null || cursor === after) return list;
    after = cursor;
  }
}

const EMPTY: CrmData = { overview: null, customers: [], open: [], paid: [], paidLoaded: false };

export function createCrmController(host: CrmHost, serverId: string): Omit<CrmViewProps, "agents"> {
  const { t, errorMessage } = useText();
  const [data, setData] = createStore<{ value: CrmData }>({ value: EMPTY });
  const [drawer, setDrawer] = createStore<{ value: CrmDrawerData | null }>({ value: null });
  const [selected, setSelected] = createSignal<string | null>(null);
  let paidWanted = false;
  let loadRun = 0;
  let drawerRun = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const payments = (input: CrmPaymentPageInput) =>
    allPages(
      (after: string | undefined) => host.payments(after === undefined ? input : { ...input, after }),
      (page) => page.payments,
      (page) => page.next,
    );

  async function load(): Promise<void> {
    const run = ++loadRun;
    const wantPaid = paidWanted;
    try {
      const [overview, customers, open, paid] = await Promise.all([
        host.overview(),
        allPages(
          (after: number | undefined) => host.customers(after),
          (page) => page.customers,
          (page) => page.next,
        ),
        payments({ state: "open" }),
        wantPaid ? payments({ state: "paid" }) : Promise.resolve(null),
      ]);
      if (disposed || run !== loadRun) return;
      setData(reconcile({ value: { overview, customers, open, paid: paid ?? [], paidLoaded: paid !== null } }, "id"));
    } catch (error) {
      if (!disposed && run === loadRun) toast.error(errorMessage(error, t("crm.page.loadFailed")));
    }
  }

  async function loadDrawer(customerId: string): Promise<void> {
    const run = ++drawerRun;
    try {
      const [activity, paid] = await Promise.all([
        allPages(
          (after: string | undefined) => host.activity(after === undefined ? { customerId } : { customerId, after }),
          (page) => page.activity,
          (page) => page.next,
        ),
        payments({ state: "paid", customerId }),
      ]);
      if (disposed || run !== drawerRun || selected() !== customerId) return;
      setDrawer(reconcile({ value: { customerId, activity, paid } }, "id"));
    } catch (error) {
      if (!disposed && run === drawerRun) toast.error(errorMessage(error, t("crm.page.loadFailed")));
    }
  }

  function reload(): void {
    void load();
    const customerId = selected();
    if (customerId !== null) void loadDrawer(customerId);
  }

  const stop = host.onChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(reload, CHANGE_DELAY_MS);
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
    stop();
  });
  void load();

  async function sourceAction(action: () => Promise<CrmApplyResult>): Promise<boolean> {
    try {
      return (await action()).ok;
    } catch (error) {
      toast.error(errorMessage(error, t("crm.page.failed")));
      return false;
    } finally {
      if (!disposed) reload();
    }
  }

  async function apply(change: CrmChange): Promise<CrmApplyResult | null> {
    try {
      const result = await host.apply(change);
      if (!result.ok) toast.info(t("crm.page.conflict"));
      return result;
    } catch (error) {
      toast.error(errorMessage(error, t("crm.page.failed")));
      return null;
    } finally {
      if (!disposed) reload();
    }
  }

  return {
    get data() {
      return data.value;
    },
    get selected() {
      return selected();
    },
    get drawer() {
      return drawer.value;
    },
    initialLayout: readLayout(serverId),
    onLayoutChange: (layout) => writeLayout(serverId, layout),
    apply,
    sources: {
      connect: (kind, key) => sourceAction(() => host.sourceConnect({ kind, key })),
      disconnect: (sourceId) => sourceAction(() => host.sourceDisconnect({ sourceId })),
      sync: (sourceId) => sourceAction(() => host.sourceSync({ sourceId })),
      openKeyPage: (kind) => host.openUrl(SOURCE_KEY_PAGE[kind]),
    },
    onLoadPaid() {
      if (paidWanted) return;
      paidWanted = true;
      void load();
    },
    onSelect(customerId) {
      setSelected(customerId);
      if (customerId === null) {
        drawerRun += 1;
        setDrawer((draft) => {
          draft.value = null;
        });
      } else if (customerId !== drawer.value?.customerId) {
        setDrawer((draft) => {
          draft.value = { customerId, activity: null, paid: null };
        });
        void loadDrawer(customerId);
      }
    },
  };
}
