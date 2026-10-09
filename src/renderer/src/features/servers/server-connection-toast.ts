import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, onCleanup } from "solid-js";

/** A retry changes the same notice. Only a recovered workspace earns a success notice. */
export function createServerConnectionToast(
  read: () => { id: string; name: string; ready: boolean; quiet: boolean } | null,
) {
  let serverId: string | null = null;
  let wasReady = false;
  let outage = false;
  const id = () => `server-connection:${serverId}`;
  const restoredId = () => `${id()}:restored`;
  createEffect(read, (value) => {
    if (value?.id !== serverId) {
      toast.dismiss(id());
      toast.dismiss(restoredId());
      serverId = value?.id ?? null;
      wasReady = false;
      outage = false;
    }
    if (!value) return;
    const { t } = currentText();
    if (value.ready) {
      toast.dismiss(id());
      if (outage) toast.success(t("server.connection.restored", { name: value.name }), { id: restoredId() });
      wasReady = true;
      outage = false;
    } else if (value.quiet) {
      outage = false;
      toast.dismiss(id());
    } else if (wasReady && !outage) {
      outage = true;
      toast(t("server.connection.reconnecting", { name: value.name }), {
        id: id(),
        description: t("server.connection.cachedHint"),
        duration: Number.POSITIVE_INFINITY,
      });
    }
  });
  onCleanup(() => {
    toast.dismiss(id());
    toast.dismiss(restoredId());
  });
}
