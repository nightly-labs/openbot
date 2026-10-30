import { useCallback, useMemo, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  decodeDefaultServer,
  decodeServerOrder,
  defaultServerKey,
  serverOrderKey,
  sortServers,
} from "@/features/workspace/model/server-order";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { currentText } from "@/shared/lib/text";

function showOrderFailure(error: unknown): void {
  showFailureAlert(
    error,
    "settings",
    currentText().t("mobile.workspace.alert.serverOrderTitle"),
    currentText().t("mobile.workspace.alert.serverOrderBody"),
  );
}

/** The order of the servers, saved on this device for the account, and a default server of an earlier version. */
export function useServerOrder(
  apiUrl: string,
  userId: string,
  pairedHostId: string | undefined,
  servers: readonly MobileServer[],
) {
  const orderKey = serverOrderKey(apiUrl, userId);
  const storedServerOrder = useMemo(() => {
    try {
      return decodeServerOrder(LockedKeychain.getItem(orderKey));
    } catch {
      return [];
    }
  }, [orderKey]);
  const [savedServerOrder, setSavedServerOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const serverOrder = savedServerOrder?.key === orderKey ? savedServerOrder.ids : storedServerOrder;
  const defaultKey = defaultServerKey(apiUrl, userId);
  const storedDefaultServer = useMemo(() => {
    try {
      return decodeDefaultServer(LockedKeychain.getItem(defaultKey), pairedHostId);
    } catch {
      return pairedHostId ?? null;
    }
  }, [defaultKey, pairedHostId]);
  const [savedDefaultServer, setSavedDefaultServer] = useState<{ key: string; id: string | null } | null>(null);
  const defaultServerId = savedDefaultServer?.key === defaultKey ? savedDefaultServer.id : storedDefaultServer;
  const orderedServers = useMemo(
    () => sortServers(servers, serverOrder, defaultServerId),
    [servers, serverOrder, defaultServerId],
  );
  const latest = useRef({ servers, serverOrder, defaultServerId, orderedServers });
  latest.current = { servers, serverOrder, defaultServerId, orderedServers };

  /** Sorts servers as the list shows them: the default server first, then the saved order. */
  const sortByPreference = useCallback(
    <T extends { id: string }>(list: readonly T[]) =>
      sortServers(list, latest.current.serverOrder, latest.current.defaultServerId),
    [],
  );

  /**
   * Saves the order of all servers; the first one opens when the app starts. A default server that an
   * earlier version saved stays first until the user orders the list, and the saved order ends it.
   * Returns false and keeps the old order on failure.
   */
  const reorderServers = useCallback(
    (serverIds: string[]) => {
      try {
        LockedKeychain.setItem(orderKey, JSON.stringify(serverIds));
        if (latest.current.defaultServerId !== null) LockedKeychain.setItem(defaultKey, JSON.stringify(null));
        setSavedServerOrder({ key: orderKey, ids: serverIds });
        setSavedDefaultServer({ key: defaultKey, id: null });
        return true;
      } catch (error) {
        showOrderFailure(error);
        return false;
      }
    },
    [orderKey, defaultKey],
  );

  return { serverOrder, defaultServerId, orderedServers, sortByPreference, reorderServers };
}
