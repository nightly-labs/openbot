import {
  parseNearAgentsInput,
  parseNearAllowPaymentInput,
  parseNearBudgetInput,
  parseNearDepositInput,
  parseNearDomainInput,
  parseNearRuleInput,
  parseNearWalletCreateInput,
} from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { NearWalletService } from "../near-wallet-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface NearWalletIpcDependencies {
  nearWallet: Pick<
    NearWalletService,
    | "status"
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
    | "checkBackup"
    | "disconnect"
  >;
}

function required<Payload>(parse: (value: unknown) => Payload | null, name: string): (value: unknown) => Payload {
  return (value) => {
    const payload = parse(value);
    if (payload === null) throw new Error(`Invalid NEAR wallet ${name}.`);
    return payload;
  };
}

export function nearWalletIpcHandlers({ nearWallet }: NearWalletIpcDependencies): Pick<IpcGroupHandlers, "nearWallet"> {
  return {
    nearWallet: {
      status: handler(() => nearWallet.status()),
      create: payloadHandler(required(parseNearWalletCreateInput, "setup"), (input) =>
        runCauseEffect(nearWallet.create(input)),
      ),
      setBudget: payloadHandler(required(parseNearBudgetInput, "budget"), ({ dailyBudgetUsd }) =>
        runCauseEffect(nearWallet.setBudget(dailyBudgetUsd)),
      ),
      setAgents: payloadHandler(required(parseNearAgentsInput, "agent list"), (input) =>
        runCauseEffect(nearWallet.setAgents(input)),
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
      checkBackup: handler(() => runCauseEffect(nearWallet.checkBackup())),
      disconnect: handler(() => runCauseEffect(nearWallet.disconnect())),
    },
  };
}
