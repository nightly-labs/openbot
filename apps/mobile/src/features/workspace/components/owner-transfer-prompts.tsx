import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";
import { type RemoteTeamDirectoryClient, runTeamEffect } from "@openbot/team-client";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

interface OwnerTransferPromptsProps {
  directory: RemoteTeamDirectoryClient;
  revision: number;
  active: boolean;
  onAccepted: () => Promise<void>;
}

export function OwnerTransferPrompts({ directory, revision, active, onAccepted }: OwnerTransferPromptsProps) {
  const asked = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const accepted = useRef(onAccepted);
  accepted.current = onAccepted;

  useEffect(() => {
    if (!active || revision < 1) return;
    let current = true;
    void runTeamEffect(directory.incomingOwnerTransfers())
      .then((transfers) => {
        if (!current) return;
        for (const transfer of transfers) {
          if (asked.current.has(transfer.transferId)) continue;
          asked.current.add(transfer.transferId);
          queue.current = queue.current.then(async () => {
            const settled = await askOwnerTransfer(directory, transfer, () => accepted.current());
            if (!settled) asked.current.delete(transfer.transferId);
          });
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [directory, revision, active]);

  return null;
}

function askOwnerTransfer(
  directory: RemoteTeamDirectoryClient,
  transfer: OwnerTransfer,
  onAccepted: () => Promise<void>,
): Promise<boolean> {
  const { t } = currentText();
  const sender = transfer.fromName || transfer.fromEmail;
  return new Promise((resolve) => {
    Alert.alert(
      t("mobile.server.ownerTransfer.incomingTitle", { server: transfer.hostName }),
      t("mobile.server.ownerTransfer.incomingBody", { name: sender, server: transfer.hostName }),
      [
        {
          text: t("mobile.server.ownerTransfer.decline"),
          style: "destructive",
          onPress: () => void declineOwnerTransfer(directory, transfer).then(resolve),
        },
        {
          text: t("mobile.server.ownerTransfer.accept"),
          onPress: () => void acceptOwnerTransfer(directory, transfer, onAccepted).then(resolve),
        },
      ],
      { cancelable: false },
    );
  });
}

async function acceptOwnerTransfer(
  directory: RemoteTeamDirectoryClient,
  transfer: OwnerTransfer,
  onAccepted: () => Promise<void>,
): Promise<boolean> {
  try {
    const result = await runTeamEffect(directory.acceptOwnerTransfer(transfer.transferId));
    void haptics.notification("success");
    await onAccepted().catch(() => undefined);
    Alert.alert(currentText().t("mobile.server.ownerTransfer.accepted", { server: result.hostName }));
    return true;
  } catch (error) {
    reportFailure(error, "mobile.server.ownerTransfer.acceptFailed");
    return false;
  }
}

async function declineOwnerTransfer(directory: RemoteTeamDirectoryClient, transfer: OwnerTransfer): Promise<boolean> {
  try {
    await runTeamEffect(directory.declineOwnerTransfer(transfer.transferId));
    return true;
  } catch (error) {
    reportFailure(error, "mobile.server.ownerTransfer.declineFailed");
    return false;
  }
}

function reportFailure(
  error: unknown,
  title: "mobile.server.ownerTransfer.acceptFailed" | "mobile.server.ownerTransfer.declineFailed",
): void {
  void haptics.notification("error");
  const text = currentText();
  showFailureAlert(
    error,
    "other",
    text.t(title),
    text.errorMessage(error, text.t("mobile.server.ownerTransfer.tryAgain")),
  );
}
