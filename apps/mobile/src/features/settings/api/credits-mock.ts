import {
  type CreditActivity,
  type CreditActivityEntry,
  type CreditServerWallet,
  type CreditsState,
  type CreditTransferRequest,
  creditsFromTenths,
  creditTenths,
} from "@openbot/contracts/credits";
import { currentText } from "@/shared/lib/text";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MOCK_DELAY_MS = 500;
const PERSONAL_BALANCE = 1236.4;
const FIRST_OWNED_BALANCE = 380.7;
const OTHER_OWNED_BALANCE = 12.3;
const MEMBER_BALANCE = 52.5;
const EXPIRING_CREDITS = 299.5;
const EXPIRING_IN_DAYS = 8;

interface CreditLedger {
  userId: string;
  personal: number;
  servers: Map<string, number>;
  entries: CreditActivityEntry[];
  seeded: boolean;
  real: CreditsState | null;
  nextId: number;
}

let ledger: CreditLedger | null = null;

function ledgerFor(userId: string): CreditLedger {
  if (ledger?.userId !== userId)
    ledger = {
      userId,
      personal: PERSONAL_BALANCE,
      servers: new Map(),
      entries: [],
      seeded: false,
      real: null,
      nextId: 1,
    };
  return ledger;
}

function entryId(book: CreditLedger): string {
  const id = `mock-${book.nextId}`;
  book.nextId += 1;
  return id;
}

function seedBalance(wallet: CreditServerWallet, ownedBefore: number) {
  if (wallet.role !== "owner") return MEMBER_BALANCE;
  return ownedBefore === 0 ? FIRST_OWNED_BALANCE : OTHER_OWNED_BALANCE;
}

export function mockCreditsState(userId: string, real: CreditsState): CreditsState {
  const book = ledgerFor(userId);
  book.real = real;
  let ownedBefore = 0;
  const servers = real.servers.map((wallet): CreditServerWallet => {
    if (!book.servers.has(wallet.serverId)) book.servers.set(wallet.serverId, seedBalance(wallet, ownedBefore));
    if (wallet.role === "owner") ownedBefore += 1;
    return {
      serverId: wallet.serverId,
      name: wallet.name,
      role: wallet.role,
      balance: book.servers.get(wallet.serverId) ?? 0,
    };
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    available: true,
    currency: real.currency,
    currencies: real.currencies.length > 0 ? real.currencies : [real.currency],
    balance: book.personal,
    servers,
    expiring: { credits: EXPIRING_CREDITS, expiresAt: today.getTime() + EXPIRING_IN_DAYS * DAY_MS },
  };
}

function seedEntries(book: CreditLedger): void {
  if (book.seeded) return;
  book.seeded = true;
  const now = Date.now();
  const owned = book.real?.servers.find((wallet) => wallet.role === "owner");
  const entries: CreditActivityEntry[] = [
    {
      id: entryId(book),
      kind: "generation",
      at: now - 20 * MINUTE_MS,
      credits: -12.5,
      actor: "you",
      modelName: "Nano Banana Pro",
    },
  ];
  if (owned)
    entries.push({
      id: entryId(book),
      kind: "generation",
      at: now - 3 * HOUR_MS,
      credits: -40.2,
      actor: "member",
      actorName: "Ada",
      serverId: owned.serverId,
      modelName: "Veo 3.1 Fast",
      status: "running",
    });
  entries.push(
    { id: entryId(book), kind: "purchase", at: now - DAY_MS, credits: 999.9, actor: "you" },
    { id: entryId(book), kind: "free", at: now - 3 * DAY_MS, credits: 100.5, actor: "openbot" },
    { id: entryId(book), kind: "expired", at: now - 10 * DAY_MS, credits: -49.8, actor: "openbot" },
  );
  book.entries.push(...entries);
}

export function mockCreditActivity(userId: string): CreditActivity {
  const book = ledgerFor(userId);
  seedEntries(book);
  return { entries: [...book.entries] };
}

export async function mockMoveCredits(userId: string, request: CreditTransferRequest): Promise<CreditsState> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  const book = ledgerFor(userId);
  const real = book.real;
  const wallet = real?.servers.find((candidate) => candidate.serverId === request.serverId);
  const { t } = currentText();
  if (!real || wallet?.role !== "owner") throw new Error(t("mobile.settings.credits.move.ownerOnly"));
  seedEntries(book);
  const tenths = creditTenths(request.credits);
  const personalTenths = creditTenths(book.personal);
  const serverTenths = creditTenths(book.servers.get(request.serverId) ?? 0);
  const toServer = request.direction === "to_server";
  if (tenths <= 0 || tenths > (toServer ? personalTenths : serverTenths))
    throw new Error(t("mobile.settings.credits.move.failed"));
  const signed = toServer ? tenths : -tenths;
  book.personal = creditsFromTenths(personalTenths - signed);
  book.servers.set(request.serverId, creditsFromTenths(serverTenths + signed));
  const now = Date.now();
  const moved = creditsFromTenths(signed);
  book.entries.unshift(
    { id: entryId(book), kind: "move", at: now, credits: -moved, actor: "you", otherServerId: request.serverId },
    { id: entryId(book), kind: "move", at: now, credits: moved, actor: "you", serverId: request.serverId },
  );
  return mockCreditsState(userId, real);
}
