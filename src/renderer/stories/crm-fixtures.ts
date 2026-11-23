import type { CrmEvery, CrmMethod, CrmPayment, CrmProposal, CrmSource, CrmTag } from "@openbot/contracts/ipc";
import type { MockCrmCustomer, MockCrmSeed } from "../src/preview/mock-crm";

const DAY = 86_400_000;
const MONTHS: Record<Exclude<CrmEvery, "once">, number> = { month: 1, quarter: 3, year: 12 };
const TAG_LABELS = ["Enterprise", "Healthcare", "Hospitality", "Logistics", "Referral", "VIP"] as const;
type TagLabel = (typeof TAG_LABELS)[number];

function localDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

interface Recurring {
  plan: string;
  amount: number;
  every: Exclude<CrmEvery, "once">;
  nextIn: number;
  history: (number | null)[];
}

interface Project {
  plan: string;
  amount: number;
  parts: { label: string; amount: number; dueIn: number; paidLate: number | null }[];
}

interface Seed {
  key: string;
  name: string;
  domain: string;
  contact: string;
  owner: string | null;
  method: CrmMethod;
  status?: "lead" | "customer" | "former";
  tags?: TagLabel[];
  details?: { phone?: string; billingEmail?: string; taxId?: string; address?: string };
  recurring?: Recurring[];
  project?: Project;
}

const month = (plan: string, amount: number, nextIn: number, history: (number | null)[]): Recurring => ({
  plan,
  amount,
  every: "month",
  nextIn,
  history,
});
const quarter = (plan: string, amount: number, nextIn: number, history: (number | null)[]): Recurring => ({
  plan,
  amount,
  every: "quarter",
  nextIn,
  history,
});
const year = (plan: string, amount: number, nextIn: number, history: (number | null)[]): Recurring => ({
  plan,
  amount,
  every: "year",
  nextIn,
  history,
});

const SEEDS: readonly Seed[] = [
  {
    key: "northwind",
    name: "Northwind Logistics",
    domain: "northwind.io",
    contact: "Anna Kowalska",
    owner: "sales",
    method: "stripe",
    tags: ["Logistics", "Enterprise"],
    details: {
      phone: "+48 22 555 0142",
      billingEmail: "invoices@northwind.io",
      taxId: "PL5213641127",
      address: "ul. Prosta 20, 00-850 Warsaw",
    },
    recurring: [month("Fleet tracking", 2400, 3, [0, 0, 0, 0, 0, 0]), year("Driver app", 4800, 47, [0])],
  },
  {
    key: "acme",
    name: "Acme Manufacturing",
    domain: "acme.com",
    contact: "Tom Becker",
    owner: "sales",
    method: "transfer",
    tags: ["Enterprise"],
    details: {
      phone: "+1 415 555 0199",
      billingEmail: "ap@acme.com",
      address: "500 Market St, San Francisco, CA 94105",
    },
    recurring: [
      month("Plant monitoring", 1800, 28, [0, 0, 5, 12, null, null]),
      year("Priority support", 3600, 130, [0]),
    ],
  },
  {
    key: "copperleaf",
    name: "Copperleaf Studio",
    domain: "copperleaf.design",
    contact: "Maya Ortiz",
    owner: null,
    method: "transfer",
    recurring: [month("Design support", 950, 15, [7, 0, 3, null])],
  },
  {
    key: "pine",
    name: "Pine & Co",
    domain: "pineandco.shop",
    contact: "Ola Nowak",
    owner: "research",
    method: "paypal",
    recurring: [month("Shop analytics", 600, 21, [0, 0, 0, null])],
  },
  {
    key: "orbit",
    name: "Orbit Analytics",
    domain: "orbit.ai",
    contact: "Lena Fischer",
    owner: "sales",
    method: "stripe",
    recurring: [month("Data seats", 3200, 1, [0, 0, 0, 0])],
  },
  {
    key: "saltmarsh",
    name: "Saltmarsh Hotels",
    domain: "saltmarsh.co.uk",
    contact: "James Reid",
    owner: "chief",
    method: "transfer",
    tags: ["Hospitality"],
    recurring: [quarter("Booking assistant", 4500, 2, [4, 0])],
  },
  {
    key: "brightharbor",
    name: "Bright Harbor Clinic",
    domain: "brightharbor.health",
    contact: "Sara Lind",
    owner: "research",
    method: "transfer",
    tags: ["Healthcare"],
    recurring: [month("Retainer", 3000, 6, [0, 0, 1, 0])],
  },
  {
    key: "fjord",
    name: "Fjord Outdoor",
    domain: "fjordoutdoor.no",
    contact: "Erik Dahl",
    owner: "sales",
    method: "stripe",
    recurring: [month("Store chat", 1200, 12, [0, 0, 0])],
  },
  {
    key: "lumen",
    name: "Lumen Health",
    domain: "lumenhealth.com",
    contact: "Priya Shah",
    owner: "research",
    method: "transfer",
    tags: ["Healthcare", "Enterprise"],
    recurring: [quarter("Clinic data plan", 7500, 21, [0, 0, 0])],
  },
  {
    key: "harborline",
    name: "Harborline Ferries",
    domain: "harborline.no",
    contact: "Ingrid Solberg",
    owner: "chief",
    method: "stripe",
    tags: ["Logistics"],
    recurring: [month("Route planner", 2800, 4, [0, 0, 1, 0, 0])],
  },
  {
    key: "greenfield",
    name: "Greenfield Farms",
    domain: "greenfield.farm",
    contact: "Tomás Reyes",
    owner: "research",
    method: "cash",
    recurring: [month("Crop forecasts", 1500, 9, [0, 0, 0])],
  },
  {
    key: "marlow",
    name: "Marlow & Finch Legal",
    domain: "marlowfinch.law",
    contact: "Clara Finch",
    owner: null,
    method: "transfer",
    recurring: [month("Contract review", 5200, 17, [2, 0, 0, null])],
  },
  {
    key: "quarry",
    name: "Quarry Stone Works",
    domain: "quarrystone.co",
    contact: "Piotr Zieliński",
    owner: "sales",
    method: "stripe",
    recurring: [month("Order desk", 900, 6, [0, 0, 0, 0])],
  },
  {
    key: "nimbus",
    name: "Nimbus Air",
    domain: "nimbusair.com",
    contact: "Ava Thompson",
    owner: "chief",
    method: "transfer",
    tags: ["Enterprise"],
    recurring: [quarter("Crew scheduling", 9600, 35, [3, 0])],
  },
  {
    key: "bluebird",
    name: "Bluebird Bakery",
    domain: "bluebirdbakery.com",
    contact: "Lucy Park",
    owner: "research",
    method: "stripe",
    recurring: [month("Order assistant", 350, 2, [0, 0, 0, 0, 0])],
  },
  {
    key: "atlas",
    name: "Atlas Freight",
    domain: "atlasfreight.eu",
    contact: "Marek Novak",
    owner: "sales",
    method: "transfer",
    tags: ["Logistics"],
    recurring: [month("Customs papers", 2100, 19, [0, null, null])],
  },
  {
    key: "solace",
    name: "Solace Spa",
    domain: "solacespa.it",
    contact: "Giulia Romano",
    owner: null,
    method: "stripe",
    tags: ["Hospitality"],
    recurring: [month("Booking assistant", 700, 24, [0, 4, 0])],
  },
  {
    key: "ironclad",
    name: "Ironclad Security",
    domain: "ironclad.dev",
    contact: "Noah Weber",
    owner: "sales",
    method: "crypto",
    recurring: [month("Alert triage", 4100, 8, [0, 0, 0, 0])],
  },
  {
    key: "meridian",
    name: "Meridian Schools",
    domain: "meridian.edu",
    contact: "Hannah Moore",
    owner: "research",
    method: "transfer",
    recurring: [quarter("Parent helpdesk", 6000, 52, [0, 0])],
  },
  {
    key: "coral",
    name: "Coral Bay Resort",
    domain: "coralbay.gr",
    contact: "Nikos Pappas",
    owner: "chief",
    method: "stripe",
    tags: ["Hospitality", "Referral"],
    recurring: [month("Guest concierge", 3600, 11, [6, 0, 0])],
  },
  {
    key: "foxglove",
    name: "Foxglove Books",
    domain: "foxglove.books",
    contact: "Emily Shaw",
    owner: null,
    method: "stripe",
    recurring: [month("Store search", 450, 26, [0, 0])],
  },
  {
    key: "polar",
    name: "Polar Cold Chain",
    domain: "polarcold.fi",
    contact: "Mikko Laine",
    owner: "sales",
    method: "transfer",
    tags: ["Logistics"],
    recurring: [month("Sensor alerts", 3900, 14, [0, 1, null])],
  },
  {
    key: "redwood",
    name: "Redwood Dental",
    domain: "redwooddental.com",
    contact: "Olivia Grant",
    owner: "research",
    method: "paypal",
    tags: ["Healthcare"],
    recurring: [month("Front desk", 800, 5, [0, 0, 0])],
  },
  {
    key: "summit",
    name: "Summit Climbing",
    domain: "summitclimb.ch",
    contact: "Lukas Meier",
    owner: null,
    method: "stripe",
    recurring: [month("Member app", 1100, 18, [0, 0, 2, 0])],
  },
  {
    key: "harvest",
    name: "Harvest Kitchen",
    domain: "harvestkitchen.co",
    contact: "Daniel Kim",
    owner: "sales",
    method: "transfer",
    recurring: [month("Supplier orders", 1300, 7, [0, 0, 0])],
  },
  {
    key: "osprey",
    name: "Osprey Drones",
    domain: "ospreydrones.com",
    contact: "Rachel Adams",
    owner: "chief",
    method: "stripe",
    recurring: [month("Flight logs", 5400, 29, [0, 0])],
  },
  {
    key: "lighthouse",
    name: "Lighthouse Media",
    domain: "lighthouse.media",
    contact: "Sofia Costa",
    owner: "research",
    method: "transfer",
    recurring: [month("Newsroom search", 2600, 10, [0, 0, 0, null])],
  },
  {
    key: "birch",
    name: "Birch & Brook",
    domain: "birchbrook.com",
    contact: "Ella Novak",
    owner: null,
    method: "crypto",
    recurring: [month("Wholesale portal", 1700, 22, [0, 0, 0])],
  },
  {
    key: "vertex",
    name: "Vertex Labs",
    domain: "vertexlabs.io",
    contact: "Arjun Mehta",
    owner: "sales",
    method: "transfer",
    tags: ["Referral"],
    recurring: [quarter("Lab notebook", 8200, 44, [7, 0])],
  },
  {
    key: "willow",
    name: "Willow Care Homes",
    domain: "willowcare.org",
    contact: "Grace Hall",
    owner: "research",
    method: "transfer",
    tags: ["Healthcare"],
    recurring: [month("Shift planner", 2300, 3, [0, 0, 0, 0])],
  },
  {
    key: "tandem",
    name: "Tandem Bikes",
    domain: "tandembikes.nl",
    contact: "Sven de Vries",
    owner: "chief",
    method: "stripe",
    recurring: [month("Repair bookings", 600, 16, [0, 0])],
  },
  {
    key: "cobalt",
    name: "Cobalt Mining",
    domain: "cobaltmining.com",
    contact: "Victor Petrov",
    owner: "sales",
    method: "transfer",
    tags: ["VIP"],
    recurring: [quarter("Site reports", 11000, 63, [0])],
  },
  {
    key: "aurora",
    name: "Aurora Theatre",
    domain: "auroratheatre.org",
    contact: "Mia Larsen",
    owner: null,
    method: "stripe",
    recurring: [month("Ticket desk", 500, 13, [3, 0, 0])],
  },
  {
    key: "kite",
    name: "Kite Insurance",
    domain: "kiteinsure.com",
    contact: "Ben Carter",
    owner: "sales",
    method: "transfer",
    tags: ["Enterprise", "Referral"],
    details: { phone: "+44 20 7946 0321", taxId: "GB 284 1934 77", address: "14 Finsbury Square, London EC2A 1BR" },
    recurring: [month("Claims intake", 6800, 1, [0, 0, 0]), month("Fraud rules", 1200, 1, [0, 0])],
  },
  {
    key: "sable",
    name: "Sable Coffee",
    domain: "sablecoffee.com",
    contact: "Chloe Martin",
    owner: "research",
    method: "paypal",
    details: { phone: "+33 1 84 88 32 10" },
    recurring: [month("Loyalty app", 400, 20, [null])],
  },
  {
    key: "granite",
    name: "Granite Bank",
    domain: "granitebank.com",
    contact: "Oscar Lindqvist",
    owner: "chief",
    method: "transfer",
    tags: ["Enterprise", "VIP"],
    recurring: [quarter("Branch assistant", 14500, 38, [0, 0]), year("Staff training", 9000, 200, [])],
  },
  {
    key: "ember",
    name: "Ember Games",
    domain: "embergames.gg",
    contact: "Leo Fischer",
    owner: "sales",
    method: "stripe",
    recurring: [month("Player support", 2900, 25, [0, 1, 0])],
  },
  {
    key: "tidewater",
    name: "Tidewater Foods",
    domain: "tidewater.com",
    contact: "Marco Bianchi",
    owner: "chief",
    method: "transfer",
    tags: ["Logistics"],
    project: {
      plan: "Warehouse rollout",
      amount: 18000,
      parts: [
        { label: "Warehouse rollout, deposit", amount: 9000, dueIn: -40, paidLate: 0 },
        { label: "Warehouse rollout, balance", amount: 9000, dueIn: -4, paidLate: null },
      ],
    },
  },
  {
    key: "kestrel",
    name: "Kestrel Energy",
    domain: "kestrel.energy",
    contact: "Nina Berg",
    owner: "sales",
    method: "transfer",
    project: {
      plan: "Energy dashboard",
      amount: 24000,
      parts: [
        { label: "Energy dashboard, part 1", amount: 12000, dueIn: -27, paidLate: 2 },
        { label: "Energy dashboard, part 2", amount: 12000, dueIn: 5, paidLate: null },
      ],
    },
  },
  {
    key: "vela",
    name: "Vela Robotics",
    domain: "velarobotics.com",
    contact: "Hugo Martin",
    owner: "chief",
    method: "transfer",
    project: {
      plan: "Robot fleet pilot",
      amount: 15000,
      parts: [{ label: "Robot fleet pilot", amount: 15000, dueIn: 20, paidLate: null }],
    },
  },
  {
    key: "quill",
    name: "Quill Press",
    domain: "quillpress.com",
    contact: "Owen Price",
    owner: null,
    method: "paypal",
    status: "former",
    project: {
      plan: "Website rebuild",
      amount: 8000,
      parts: [
        { label: "Website rebuild, deposit", amount: 4000, dueIn: -160, paidLate: 0 },
        { label: "Website rebuild, balance", amount: 4000, dueIn: -110, paidLate: 6 },
      ],
    },
  },
  {
    key: "lumos",
    name: "Lumos Optics",
    domain: "lumosoptics.com",
    contact: "Iris Wong",
    owner: "sales",
    method: "transfer",
    status: "lead",
    tags: ["Healthcare"],
  },
  {
    key: "deltarail",
    name: "Delta Rail",
    domain: "deltarail.eu",
    contact: "Jonas Weber",
    owner: "chief",
    method: "transfer",
    status: "lead",
    tags: ["Logistics", "Enterprise"],
  },
  {
    key: "nordlys",
    name: "Nordlys Hotels",
    domain: "nordlys.no",
    contact: "Kari Nilsen",
    owner: "sales",
    method: "transfer",
    status: "lead",
    tags: ["Hospitality"],
  },
  {
    key: "pebble",
    name: "Pebble Pet Care",
    domain: "pebblepets.com",
    contact: "Zoe Clarke",
    owner: null,
    method: "transfer",
    status: "lead",
  },
];

function stripeId(key: string): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
  let hash = 7;
  let out = "cus_";
  for (let index = 0; index < 14; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index % key.length) + index) % 1_000_003;
    out += letters[hash % letters.length];
  }
  return out;
}

export function crmDemoSeed(now = Date.now(), options: { stripe?: boolean } = {}): MockCrmSeed {
  const today = localDate(now);
  const source = (method: CrmMethod) => (options.stripe && method === "stripe" ? "stripe" : null);
  const at = (days: number) => new Date(now + days * DAY).toISOString();
  const tags: CrmTag[] = TAG_LABELS.map((label) => ({ id: `tag-${label.toLowerCase()}`, label }));
  const tagId = (label: TagLabel) => `tag-${label.toLowerCase()}`;
  const customers: MockCrmCustomer[] = [];
  const payments: Omit<CrmPayment, "number">[] = [];

  for (const seed of SEEDS) {
    const id = `customer-${seed.key}`;
    const plans: MockCrmCustomer["plans"] = [];
    const add = (
      planId: string,
      label: string,
      amount: number,
      dueOn: string,
      paidLate: number | null,
      owner: CrmSource["kind"] | null,
    ) => {
      const paid = paidLate === null ? null : Math.min(new Date(`${dueOn}T12:00:00`).getTime() + paidLate * DAY, now);
      payments.push({
        id: `payment-${payments.length + 1}`,
        customerId: id,
        planId,
        label,
        amountMinor: amount * 100,
        currency: "EUR",
        dueOn,
        paidAt: paid === null ? null : new Date(paid).toISOString(),
        method: seed.method,
        source: owner,
      });
    };
    for (const [index, recurring] of (seed.recurring ?? []).entries()) {
      const planId = `plan-${seed.key}-${index + 1}`;
      const step = MONTHS[recurring.every];
      const next = localDate(now + recurring.nextIn * DAY);
      const first = addMonths(next, -step * recurring.history.length);
      plans.push({
        id: planId,
        customerId: id,
        name: recurring.plan,
        amountMinor: recurring.amount * 100,
        every: recurring.every,
        startsOn: first,
        endsOn: null,
        source: source(seed.method),
      });
      recurring.history.forEach((late, period) => {
        add(planId, recurring.plan, recurring.amount, addMonths(first, period * step), late, source(seed.method));
      });
      add(
        planId,
        recurring.plan,
        recurring.amount,
        addMonths(first, recurring.history.length * step),
        null,
        source(seed.method),
      );
    }
    if (seed.project) {
      const planId = `plan-${seed.key}-project`;
      const first = Math.min(...seed.project.parts.map((part) => part.dueIn));
      plans.push({
        id: planId,
        customerId: id,
        name: seed.project.plan,
        amountMinor: seed.project.amount * 100,
        every: "once",
        startsOn: localDate(now + first * DAY),
        endsOn: null,
        source: null,
      });
      for (const part of seed.project.parts)
        add(planId, part.label, part.amount, localDate(now + part.dueIn * DAY), part.paidLate, null);
    }
    const contactFirst = seed.contact.split(" ")[0]?.toLowerCase() ?? "hello";
    const firstDue = payments.filter((payment) => payment.customerId === id).map((payment) => payment.dueOn)[0];
    const createdAt = firstDue ? new Date(`${firstDue}T09:00:00`).getTime() - 7 * DAY : now - 14 * DAY;
    customers.push({
      id,
      number: customers.length + 1,
      name: seed.name,
      contactName: seed.contact,
      contactEmail: `${contactFirst}@${seed.domain}`,
      phone: seed.details?.phone ?? "",
      billingEmail: seed.details?.billingEmail ?? "",
      domain: seed.domain,
      taxId: seed.details?.taxId ?? "",
      address: seed.details?.address ?? "",
      stripeCustomerId: seed.method === "stripe" ? stripeId(seed.key) : "",
      notes: "",
      statusId: seed.status ?? "customer",
      ownerAgentId: seed.owner,
      method: seed.method,
      currency: "EUR",
      tagIds: (seed.tags ?? []).map(tagId),
      plans,
      source: source(seed.method),
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(now).toISOString(),
      revision: 1,
    });
  }

  const numbered: CrmPayment[] = [...payments]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
    .map((payment, index) => ({ ...payment, number: 1001 + index }));
  const open = (key: string) => {
    const payment = numbered.find((entry) => entry.customerId === `customer-${key}` && entry.paidAt === null);
    if (!payment) throw new Error(`The demo customer ${key} has no open payment.`);
    return payment;
  };
  const late = (key: string) => {
    const payment = numbered.find(
      (entry) => entry.customerId === `customer-${key}` && entry.paidAt === null && entry.dueOn < today,
    );
    if (!payment) throw new Error(`The demo customer ${key} has no late payment.`);
    return payment;
  };

  const proposals: CrmProposal[] = [
    {
      id: "proposal-acme-paid",
      agentId: "sales",
      customerId: "customer-acme",
      threadId: null,
      reason: "Tom Becker wrote: we sent the transfer yesterday. You should see it today.",
      change: { kind: "payment-paid", paymentIds: [late("acme").id], paidAt: at(-1) },
      createdAt: at(-40 / 1440),
    },
    {
      id: "proposal-tidewater-split",
      agentId: "chief",
      customerId: "customer-tidewater",
      threadId: null,
      reason: "Marco Bianchi asked on WhatsApp to pay the balance in two parts: half now and half next month.",
      change: {
        kind: "payment-split",
        paymentId: open("tidewater").id,
        parts: [
          { amountMinor: 450_000, dueOn: localDate(now + 3 * DAY) },
          { amountMinor: 450_000, dueOn: localDate(now + 33 * DAY) },
        ],
      },
      createdAt: at(-2 / 24),
    },
    {
      id: "proposal-pine-due",
      agentId: "research",
      customerId: "customer-pine",
      threadId: null,
      reason:
        "Ola says in Slack #billing that their PayPal account is blocked. They send a bank transfer within a week.",
      change: { kind: "payment-update", paymentId: late("pine").id, patch: { dueOn: localDate(now + 5 * DAY) } },
      createdAt: at(-5 / 24),
    },
    {
      id: "proposal-northwind-price",
      agentId: "sales",
      customerId: "customer-northwind",
      threadId: null,
      reason: "Anna confirmed the two new depots in Slack #sales. The plan goes up from the next payment.",
      change: { kind: "plan-update", planId: "plan-northwind-1", patch: { amountMinor: 290_000 } },
      createdAt: at(-26 / 24),
    },
    {
      id: "proposal-harbor-dental",
      agentId: "research",
      customerId: null,
      threadId: null,
      reason: "Harbor Dental signed up for the Starter plan on the website form and paid with Stripe.",
      change: {
        kind: "customer-create",
        customer: {
          name: "Harbor Dental",
          statusId: "customer",
          ownerAgentId: "research",
          method: "stripe",
          currency: "EUR",
          contactName: "Ines Costa",
          contactEmail: "ines@harbordental.com",
          domain: "harbordental.com",
        },
      },
      createdAt: at(-30 / 24),
    },
  ];

  const sources: CrmSource[] = options.stripe
    ? [
        {
          id: "source-stripe",
          kind: "stripe",
          testMode: false,
          accountLabel: "Northstar Studio",
          keyHint: "x7Qe",
          state: "ok",
          errorCode: null,
          syncedAt: at(-3 / 1440),
          connectedAt: at(-30),
          skipped: { currency: 2, interval: 1, limit: 0 },
        },
      ]
    : [];
  const owned = new Set(numbered.filter((payment) => payment.source !== null).map((payment) => payment.id));
  const ownedPlans = new Set(
    customers.flatMap((customer) => customer.plans.filter((plan) => plan.source !== null).map((plan) => plan.id)),
  );
  const allowed = proposals.filter(({ change }) => {
    if (change.kind === "payment-paid") return !change.paymentIds.some((id) => owned.has(id));
    if (change.kind === "payment-split" || change.kind === "payment-update") return !owned.has(change.paymentId);
    if (change.kind === "plan-update") return !ownedPlans.has(change.planId);
    return true;
  });

  return {
    tags,
    customers,
    payments: numbered,
    proposals: allowed,
    sources,
    agentIds: ["chief", "research", "sales"],
  };
}
