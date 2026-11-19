import {
  type HostedServerCatalog,
  type HostedServerList,
  type HostedServerSummary,
  parseHostedServerCatalog,
  parseHostedServerList,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

export interface HostedServerCalls {
  list(): Promise<HostedServerList>;
  plans(): Promise<HostedServerCatalog>;
  wake(serverId: string): Promise<HostedServerSummary>;
  restart(serverId: string): Promise<HostedServerSummary>;
}

export function hostedServerCalls(session: MobileSession): HostedServerCalls {
  const { t } = currentText();
  const serverPath = (serverId: string, action: string) =>
    `/v2/hosting/servers/${encodeURIComponent(serverId)}/${action}`;
  return {
    list: () =>
      requestMobileAccount(
        session,
        "/v2/hosting/servers/",
        {},
        parseHostedServerList,
        t("mobile.server.hosted.loadFailed"),
      ),
    plans: () =>
      requestMobileAccount(
        session,
        "/v2/hosting/plans",
        {},
        parseHostedServerCatalog,
        t("mobile.server.hosted.loadFailed"),
      ),
    wake: (serverId) =>
      requestMobileAccount(
        session,
        serverPath(serverId, "wake"),
        { method: "POST" },
        parseHostedServerSummary,
        t("mobile.server.hosted.wakeFailed"),
      ),
    restart: (serverId) =>
      requestMobileAccount(
        session,
        serverPath(serverId, "restart"),
        { method: "POST" },
        parseHostedServerSummary,
        t("mobile.server.hosted.restartFailed"),
        30_000,
      ),
  };
}
