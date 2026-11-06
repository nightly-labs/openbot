import { skipToken, useQuery } from "@tanstack/react-query";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";

/**
 * The server IDs of the owner's hosted servers, or null until the account server lists them.
 * Billing deletes a hosted server, so Remove shows only after the list is known.
 */
export function useOwnerHostedServerIds(server: MobileServer | undefined): ReadonlySet<string> | null {
  const { session } = useMobileSession();
  const queryScope = useQueryScope();
  // Server settings reads the list when it opens. Restart and Remove read the same result.
  // The list goes with the page.
  const list = useQuery({
    queryKey: queryKeys.ownerHostedServerIds(queryScope),
    queryFn:
      session && server?.role === "owner"
        ? async (): Promise<ReadonlySet<string>> =>
            new Set((await hostedServerCalls(session).list()).servers.map((item) => item.serverId))
        : skipToken,
    retry: false,
    refetchOnMount: false,
    gcTime: 0,
  });
  return list.data ?? null;
}

/** The same rule as the Restart item of the desktop server menu. */
export function canRestartServer(server: MobileServer, hostedServerIds: ReadonlySet<string> | null): boolean {
  return (
    server.kind === "remote" &&
    (server.role === "owner" || server.role === "admin") &&
    (server.hosted === true || Boolean(hostedServerIds?.has(server.id)))
  );
}
