// The NEAR Intents wallet of this computer. The renderer sends a partner key once and never gets it
// back; no endpoint returns a key, a grant token or a signature. Payments start in agents only: the
// renderer can approve the payment rules, never a recipient or an amount of its own.

import {
  parseNearAgentsInput,
  parseNearAllowPaymentInput,
  parseNearBudgetInput,
  parseNearDepositInput,
  parseNearDomainInput,
  parseNearPartnerKey,
  parseNearRuleInput,
  parseNearWalletCreateInput,
} from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { NearWalletService } from "../near-wallet-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface NearWalletIpcDependencies {
  nearWallet: Pick<
    NearWalletService,
    | "status"
    | "setKey"
    | "create"
    | "setBudget"
    | "setAgents"
    | "renewGrant"
    | "freeze"
    | "unfreeze"
    | "deposit"
    | "saveRule"
    | "removeRule"
    | "allowPayment"
    | "openSigning"
    | "cancelSigning"
    | "disconnect"
  >;
}

/** Turns a contract parser into a payload decoder. The error names no value the renderer sent. */
function required<Payload>(parse: (value: unknown) => Payload | null, name: string): (value: unknown) => Payload {
  return (value) => {
    const payload = parse(value);
    if (payload === null) throw new Error(`Invalid NEAR wallet ${name}.`);
    return payload;
  };
}

/** The key is registered for redaction before anything can fail with it. */
function decodePartnerKey(value: unknown): string {
  const key = parseNearPartnerKey(value);
  if (key === null) throw new Error("Invalid NEAR wallet partner key.");
  registerSecretValue(key);
  return key;
}

export function nearWalletIpcHandlers({ nearWallet }: NearWalletIpcDependencies): Pick<IpcGroupHandlers, "nearWallet"> {
  return {
    nearWallet: {
      status: handler(() => nearWallet.status()),
      setKey: payloadHandler(decodePartnerKey, (key) => runCauseEffect(nearWallet.setKey(key))),
      create: payloadHandler(required(parseNearWalletCreateInput, "setup"), (input) =>
        runCauseEffect(nearWallet.create(input)),
      ),
      setBudget: payloadHandler(required(parseNearBudgetInput, "budget"), ({ dailyBudgetUsd }) =>
        runCauseEffect(nearWallet.setBudget(dailyBudgetUsd)),
      ),
      setAgents: payloadHandler(required(parseNearAgentsInput, "agent list"), ({ agentIds }) =>
        runCauseEffect(nearWallet.setAgents(agentIds)),
      ),
      renewGrant: handler(() => runCauseEffect(nearWallet.renewGrant())),
      freeze: handler(() => runCauseEffect(nearWallet.freeze())),
      unfreeze: handler(() => runCauseEffect(nearWallet.unfreeze())),
      deposit: payloadHandler(required(parseNearDepositInput, "deposit"), (input) =>
        runCauseEffect(nearWallet.deposit(input)),
      ),
      saveRule: payloadHandler(required(parseNearRuleInput, "rule"), (input) =>
        runCauseEffect(nearWallet.saveRule(input)),
      ),
      removeRule: payloadHandler(required(parseNearDomainInput, "domain"), ({ domain }) =>
        runCauseEffect(nearWallet.removeRule(domain)),
      ),
      allowPayment: payloadHandler(required(parseNearAllowPaymentInput, "payment"), (input) =>
        runCauseEffect(nearWallet.allowPayment(input)),
      ),
      openSigning: handler(() => runCauseEffect(nearWallet.openSigning())),
      cancelSigning: handler(() => nearWallet.cancelSigning()),
      disconnect: handler(() => runCauseEffect(nearWallet.disconnect())),
    },
  };
}
