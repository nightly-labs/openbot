import type { CentralAuthManager } from "./central-auth-manager";
import type { RemoteServerManager } from "./remote-server-manager";

export function forwardOwnerTransferReloads(
  directory: RemoteServerManager,
  centralAuth: CentralAuthManager,
  forward: () => void,
): () => void {
  const directoryInvalidated = () => {
    if (!centralAuth.listsOwnerTransfers()) forward();
  };
  directory.on("directoryInvalidated", directoryInvalidated);
  centralAuth.on("ownerTransfersListed", forward);
  return () => {
    directory.off("directoryInvalidated", directoryInvalidated);
    centralAuth.off("ownerTransfersListed", forward);
  };
}
