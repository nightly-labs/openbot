import type { CreditMediaGenerationKind } from "@openbot/contracts/credit-media";
import { mediaApprovalDefaultModelUpdate } from "@openbot/contracts/ipc";
import { saveMediaApprovalCredits } from "../servers/media-approval-credits-store";

export function desktopMediaApprovalDefault(serverId: () => string) {
  return async (kind: CreditMediaGenerationKind, model: string | null): Promise<void> => {
    await saveMediaApprovalCredits(serverId(), mediaApprovalDefaultModelUpdate(kind, model), window.openbot.hostAdmin);
  };
}
