import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, Button, OctagonX, Puzzle } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { WizardDialog } from "./IntegrationLayout";

export interface McpConnectSubject {
  name: string;
  iconUrl: string | null;
  config: McpServerConfig;
}

export interface McpConnectBaseProps {
  open: boolean;
  subject: McpConnectSubject;
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
  onConnected: (config: McpServerConfig) => void;
  onCancel: () => void;
  connectOnOpen?: boolean | undefined;
  alternative?: JSX.Element;
}

export interface ConnectState {
  phase: "idle" | "connecting" | "failed";
  error: string;
}

export function createConnectRun(props: Pick<McpConnectBaseProps, "onTest" | "onConnected">) {
  const { t, errorMessage, sourceText } = useText();
  const [state, setState] = createStore<ConnectState>({ phase: "idle", error: "" });
  let run = 0;
  const busy = () => state.phase === "connecting";
  onCleanup(() => {
    run += 1;
  });

  function forget() {
    setState((current) => {
      if (!busy()) current.phase = "idle";
      current.error = "";
    });
  }

  async function attempt(authorize: () => Promise<McpServerConfig>) {
    if (busy()) return;
    const started = ++run;
    setState((current) => {
      current.phase = "connecting";
      current.error = "";
    });
    try {
      const authorized = await authorize();
      if (started !== run) return;
      const result = await props.onTest(authorized);
      if (started !== run) return;
      if (result.error) {
        setState((current) => {
          current.phase = "failed";
          current.error = sourceText(result.error ?? "");
        });
        return;
      }
      props.onConnected(authorized);
    } catch (cause) {
      if (started !== run) return;
      setState((current) => {
        current.phase = "failed";
        current.error = errorMessage(cause, t("mcp.connect.unreachable"));
      });
    }
  }

  return { state, busy, forget, attempt };
}

export interface McpConnectShellProps
  extends Pick<McpConnectBaseProps, "open" | "subject" | "onCancel" | "alternative"> {
  state: ConnectState;
  busy: () => boolean;
  description: JSX.Element;
  children?: JSX.Element;
  action: JSX.Element;
  onSubmit: () => void;
  wide?: boolean | undefined;
  onCancelBusy?: (() => void) | undefined;
}

export function McpConnectMark(props: { iconUrl: string | null | undefined }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.iconUrl && props.iconUrl !== failed() ? props.iconUrl : null);
  return (
    <Show when={url()} fallback={<Puzzle aria-hidden="true" />} keyed>
      {(src) => <img src={src} alt="" onError={() => setFailed(src)} />}
    </Show>
  );
}

export function McpConnectShell(props: McpConnectShellProps) {
  const { t } = useText();
  const close = () => {
    if (!props.busy()) return props.onCancel();
    if (!props.onCancelBusy) return;
    props.onCancelBusy();
    props.onCancel();
  };
  const stuck = () => props.busy() && !props.onCancelBusy;
  return (
    <WizardDialog
      open={props.open}
      nested
      wide={props.wide}
      closeLabel={t("mcp.connect.close", { name: props.subject.name })}
      closeDisabled={stuck()}
      dismissible={!props.busy()}
      onClose={close}
      logo={<McpConnectMark iconUrl={props.subject.iconUrl} />}
      link={props.state.phase === "failed" ? "broken" : "connecting"}
      title={t("mcp.connect.title", { name: props.subject.name })}
      description={props.description}
      onSubmit={props.onSubmit}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" disabled={stuck()} onClick={close}>
            {t("common.cancel")}
          </Button>
          {props.action}
        </>
      }
    >
      {props.children}
      {props.alternative}
      <Show when={props.state.phase === "failed"}>
        <Alert tone="danger" role="alert">
          <AlertIcon>
            <OctagonX />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("mcp.connect.notConnected")}</AlertTitle>
            <AlertDescription>{props.state.error}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>
    </WizardDialog>
  );
}
