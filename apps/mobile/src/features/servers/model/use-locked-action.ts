import { useRef, useState } from "react";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Runs one action at a time and keeps its error. A tap while an action runs does nothing. `failure`
 * gives the error text; without it the text is the general update failure.
 */
export function useLockedAction() {
  const { t } = useText();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(operation: () => Promise<void>, failure?: (error: unknown) => string): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
    } catch (caught) {
      setError(failure?.(caught) ?? t("mobile.server.settings.updateFailed"));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, perform };
}
