import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { BitwardenConnectorPanelProps } from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createStore, onSettled } from "solid-js";
import { bitwardenConnectorPort } from "./bitwarden-connector-port";

/** The local connection is shared by the Marketplace and server settings. */
export function createBitwardenConnector(port = bitwardenConnectorPort): BitwardenConnectorPanelProps {
  const [state, setState] = createStore({ status: { connected: false }, busy: false });
  let disposed = false;
  let attempt = 0;
  onSettled(() => {
    const unsubscribe = port().onChanged((status) => {
      if (!disposed)
        setState((draft) => {
          draft.status = status;
        });
    });
    const current = attempt;
    void port()
      .status()
      .then((status) => {
        if (!disposed && current === attempt)
          setState((draft) => {
            draft.status = status;
          });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  });
  const run = (action: () => Promise<BitwardenConnectorStatus>) => {
    const current = ++attempt;
    setState((draft) => {
      draft.busy = true;
    });
    void action()
      .then((status) => {
        if (!disposed && current === attempt)
          setState((draft) => {
            draft.status = status;
          });
      })
      .catch((error: unknown) => {
        if (disposed || current !== attempt) return;
        const { t, errorMessage } = currentText();
        toast.error(errorMessage(error, t("connector.bitwarden.failed")), {
          report: { operation: "other", source: "system", cause_code: classifyFailure(error) },
        });
      })
      .finally(() => {
        if (!disposed && current === attempt)
          setState((draft) => {
            draft.busy = false;
          });
      });
  };
  return {
    get status() {
      return state.status;
    },
    get busy() {
      return state.busy;
    },
    onConnect: (key) => {
      if (!state.busy) run(() => port().connect(key));
    },
    onDisconnect: () => run(() => port().disconnect()),
  };
}
