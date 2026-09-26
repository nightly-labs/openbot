import type { MobileConnectHostBinding, MobileConnectTicket } from "@openbot/contracts/mobile-connect";
import { sourceText } from "@openbot/i18n/source";
import type { CentralAuthManager } from "./central-auth-manager";

interface MobileConnectHostDependencies {
  centralAuth: Pick<CentralAuthManager, "createMobileConnect">;
  host: {
    configure(input: { serverName: string }): Promise<unknown>;
    getStatus(): { configured: boolean };
    getMobileConnectHost(): MobileConnectHostBinding | null;
    start(): Promise<{
      serverId: string | null;
      phase: string;
      apiOnline: boolean;
      apiUrl: string | null;
      message: string | null;
    }>;
  };
}

export async function createHostedMobileConnect({
  centralAuth,
  host,
}: MobileConnectHostDependencies): Promise<MobileConnectTicket> {
  if (!host.getStatus().configured) await host.configure({ serverName: "OpenBot" });
  const status = await host.start();
  if (!isPublishedHost(status)) {
    throw new Error(status.message ?? sourceText("error.host.mobileConnectPublishFailed"));
  }
  const binding = host.getMobileConnectHost();
  if (!binding || binding.hostId !== status.serverId)
    throw new Error(sourceText("error.host.mobileConnectHostChanged"));
  return centralAuth.createMobileConnect(binding);
}

function isPublishedHost(status: { phase: string; apiOnline: boolean; apiUrl: string | null }): boolean {
  if (status.phase !== "online" || !status.apiOnline || !status.apiUrl) return false;
  try {
    const protocol = new URL(status.apiUrl).protocol;
    return protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
}
