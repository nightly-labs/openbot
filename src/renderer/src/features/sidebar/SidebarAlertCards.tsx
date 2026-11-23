import { canAdministerServer, type ServerSummary, type TeamPresenceMember } from "@openbot/contracts/ipc";
import { SidebarMachineCard } from "@openbot/ui/features/sidebar/SidebarMachineCard";
import { SidebarStorageCard } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { createMemo, Show } from "solid-js";
import { createMachineCard } from "./machine-card";
import { type SidebarCardsPort, sidebarPort } from "./sidebar-port";
import { createStorageCard } from "./storage-card";

export function createSidebarAlertCards(
  server: () => ServerSummary | undefined,
  port: () => SidebarCardsPort = sidebarPort,
) {
  const storageCard = createStorageCard(server, port);
  const machineCard = createMachineCard(server, port);
  const footerCard = createMemo(() => {
    const machine = machineCard.card();
    const storage = storageCard.card();
    if (machine && (machine.metric === "disk" || !storage || (machine.critical && storage.level !== "full")))
      return { kind: "machine" as const, card: machine };
    return storage ? { kind: "storage" as const, card: storage } : null;
  });
  return {
    storageCard,
    machineCard,
    shown: () => footerCard() !== null,
    machine: () => {
      const shown = footerCard();
      return shown?.kind === "machine" ? shown.card : null;
    },
    storage: () => {
      const shown = footerCard();
      return shown?.kind === "storage" ? shown.card : null;
    },
    refresh: () => {
      storageCard.refresh();
      machineCard.refresh();
    },
  };
}

type SidebarAlertCardsState = ReturnType<typeof createSidebarAlertCards>;

interface SidebarAlertCardsProps {
  cards: SidebarAlertCardsState;
  serverName: string;
  members: readonly TeamPresenceMember[];
  onOpenStorage: (serverId: string) => void;
}

export function SidebarAlertCards(props: SidebarAlertCardsProps) {
  const machineRecipient = (memberId: string | null) => {
    const member =
      props.members.find(
        (candidate) => candidate.id === memberId && !candidate.disabled && canAdministerServer(candidate.role),
      ) ?? props.members.find((candidate) => candidate.role === "owner");
    return member ? member.name?.trim() || member.username : null;
  };
  return (
    <>
      <Show when={props.cards.machine()}>
        {(card) => (
          <SidebarMachineCard
            serverName={props.serverName}
            metric={card().metric}
            percent={card().percent}
            level={card().level}
            freeBytes={card().freeBytes}
            critical={card().critical}
            recipientName={machineRecipient(card().responsibleMemberId)}
            onOpenDetails={() => props.onOpenStorage(card().serverId)}
            onDismiss={() => props.cards.machineCard.dismiss(card().serverId, card())}
          />
        )}
      </Show>
      <Show when={props.cards.storage()}>
        {(card) => (
          <SidebarStorageCard
            level={card().level}
            serverName={props.serverName}
            freeBytes={card().freeBytes}
            totalBytes={card().totalBytes}
            hostedPlan={card().hostedPlan}
            thisComputer={card().thisComputer}
            onFreeUpSpace={() => props.onOpenStorage(card().serverId)}
            onDismiss={() => props.cards.storageCard.dismiss(card().serverId)}
          />
        )}
      </Show>
    </>
  );
}
