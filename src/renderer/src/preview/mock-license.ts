import type { LicenseDesktopApi } from "@openbot/contracts/ipc";
import {
  LICENSE_INCLUDED_USERS,
  type LicensePlan,
  type LicenseState,
  type LicenseUser,
  licenseMonthlyAmount,
  licensePlanOf,
} from "@openbot/contracts/license";
import { sourceText } from "@openbot/i18n/source";

const DAY = 24 * 60 * 60_000;

/** The owner and the members of the preview servers. */
export function previewLicenseUsers(): LicenseUser[] {
  return [
    { name: "Ana Kowalska", email: "ana@example.com", servers: ["Office server", "Lab"], owner: true },
    { name: "Jan Nowak", email: "jan@example.com", servers: ["Office server"], owner: false },
    { name: null, email: "maria.silva@example.com", servers: ["Lab"], owner: false },
    { name: "Kenji Sato", email: "kenji@example.com", servers: ["Office server", "Lab"], owner: false },
  ];
}

/**
 * The preview account has no license unless `initial` gives one. Checkout acts as Stripe would after
 * payment: it makes an active license. Users, plan and renewal change it as the account server does.
 */
export function createMockLicense(initial: Partial<LicenseState> = {}): LicenseDesktopApi {
  const users = previewLicenseUsers();
  const state: LicenseState = {
    available: true,
    currency: "eur",
    license: null,
    used: users.length,
    users,
    coveredBy: [],
    ...initial,
  };
  return {
    getState: async () => structuredClone(state),
    openCheckout: async (request) => {
      if (request.users < state.used) throw new Error(sourceText("error.billing.licenseUsersInUse"));
      const plan: LicensePlan = {
        tier: request.tier ?? "team",
        interval: request.interval ?? "month",
        bundle: state.bundle ?? false,
      };
      state.license = {
        subscriptionId: "sub_preview_license",
        users: request.users,
        currency: request.currency,
        amount: licenseMonthlyAmount(plan, request.users, request.currency),
        ...plan,
        // During a promotion the license is free until the trial end, and its first period starts then.
        status: state.trialEnd === undefined ? "active" : "trialing",
        currentPeriodEnd: state.trialEnd ?? Date.now() + (plan.interval === "year" ? 365 : 30) * DAY,
        cancelAtPeriodEnd: false,
      };
    },
    setUsers: async (request) => {
      const license = state.license;
      if (!license) throw new Error(sourceText("error.billing.noLicense"));
      if (licensePlanOf(license).tier !== "team") throw new Error(sourceText("error.billing.licenseOneUser"));
      if (request.users < Math.max(LICENSE_INCLUDED_USERS, state.used)) {
        throw new Error(sourceText("error.billing.licenseUsersInUse"));
      }
      license.users = request.users;
      license.amount = licenseMonthlyAmount(licensePlanOf(license), request.users, license.currency);
      return structuredClone(state);
    },
    changePlan: async (request) => {
      const license = state.license;
      if (!license) throw new Error(sourceText("error.billing.noLicense"));
      const from = licensePlanOf(license);
      if (from.tier === "team" && !(from.interval === "month" && request.interval === "year")) {
        throw new Error(sourceText("error.billing.licensePlanChange"));
      }
      if (request.users < Math.max(LICENSE_INCLUDED_USERS, state.used)) {
        throw new Error(sourceText("error.billing.licenseUsersInUse"));
      }
      const plan: LicensePlan = { tier: "team", interval: request.interval, bundle: from.bundle };
      Object.assign(license, {
        ...plan,
        users: request.users,
        amount: licenseMonthlyAmount(plan, request.users, license.currency),
        currentPeriodEnd: request.interval === from.interval ? license.currentPeriodEnd : Date.now() + 365 * DAY,
      });
      return structuredClone(state);
    },
    setRenewal: async (request) => {
      if (!state.license) throw new Error(sourceText("error.billing.noLicense"));
      state.license.cancelAtPeriodEnd = request.cancel;
      return structuredClone(state);
    },
  };
}
