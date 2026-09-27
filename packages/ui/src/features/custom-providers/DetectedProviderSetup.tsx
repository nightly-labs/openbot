import type { CustomProviderRestart } from "@openbot/contracts/ipc";
import { createEffect, createSignal } from "solid-js";
import { useText } from "../../text";
import { CustomAcpAgentDialog } from "./CustomAcpAgentDialog";
import { CustomProviderDialog } from "./CustomProviderDialog";
import type { AcpAgentCheck, CustomAcpAgentDraft } from "./custom-acp-agent-form";
import type { CustomProviderEndpoint, ModelDiscovery } from "./custom-provider-form";
import {
  type DetectedProvider,
  type DetectedProviderApi,
  type DetectedProviderValue,
  detectedAgentDraft,
  detectedModelsDraft,
} from "./detected-providers";

interface DetectedProviderSetupProps {
  /** The provider to add or edit. `null` keeps both forms closed. */
  provider: DetectedProvider | null;
  api: DetectedProviderApi;
  takenProviderIds?: readonly string[] | undefined;
  takenAgentIds?: readonly string[] | undefined;
  onClose: () => void;
  /** After a save, so the host can say when the new models appear. */
  onSaved?: ((kind: DetectedProvider["kind"], restart: CustomProviderRestart | undefined) => void) | undefined;
}

/**
 * The step between Add and a saved provider: the form of its kind, filled from what the scan found,
 * so the user sees and can change every value before OpenBot saves it.
 */
export function DetectedProviderSetup(props: DetectedProviderSetupProps) {
  const { t, errorMessage } = useText();
  const [saving, setSaving] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  const [discovery, setDiscovery] = createSignal<ModelDiscovery>({ status: "idle" });
  const [check, setCheck] = createSignal<AcpAgentCheck>({ status: "idle" });

  const models = () => (props.provider?.kind === "models" ? props.provider : undefined);
  const agent = () => (props.provider?.kind === "agent" ? props.provider : undefined);
  const modelsDraft = () => {
    const provider = models();
    return provider ? detectedModelsDraft(provider) : undefined;
  };
  const agentDraft = () => {
    const provider = agent();
    return provider ? detectedAgentDraft(provider) : undefined;
  };
  /** A provider that is already saved keeps its own ID, so its ID is not a duplicate of itself. */
  const taken = (ids: readonly string[] | undefined) =>
    (ids ?? []).filter((id) => !(props.provider?.added && id === props.provider.id));

  // Each open starts from the scan result: the models it listed are already found and selected.
  createEffect(
    () => props.provider,
    (provider) => {
      setSaving(false);
      setSubmitError(null);
      setCheck({ status: "idle" });
      // A preset with no scan result has no list yet, not an empty one.
      setDiscovery(
        provider?.kind === "models" && provider.models.length > 0
          ? { status: "found", models: provider.models }
          : { status: "idle" },
      );
    },
  );

  async function save(value: DetectedProviderValue): Promise<void> {
    const provider = props.provider;
    if (!provider) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const restart = await props.api.save(provider, value);
      props.onSaved?.(value.kind, restart);
      props.onClose();
    } catch (error) {
      setSubmitError(errorMessage(error, t("customProvider.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function discover(endpoint: CustomProviderEndpoint): Promise<void> {
    const discoverModels = props.api.discoverModels;
    if (!discoverModels) return;
    setDiscovery({ status: "loading" });
    const saved = models();
    try {
      const request = saved?.added ? { ...endpoint, savedProviderId: saved.id } : endpoint;
      setDiscovery({ status: "found", models: await discoverModels(request) });
    } catch (error) {
      setDiscovery({ status: "failed", message: errorMessage(error, t("customProvider.discovery.empty")) });
    }
  }

  async function runCheck(value: CustomAcpAgentDraft): Promise<void> {
    const checkAgent = props.api.checkAgent;
    if (!checkAgent) return;
    setCheck({ status: "checking" });
    const saved = agent();
    try {
      setCheck(await checkAgent(value, saved?.added ? saved.id : undefined));
    } catch (error) {
      setCheck({ status: "failed", message: errorMessage(error, t("customProvider.acp.checkFailed")) });
    }
  }

  return (
    <>
      <CustomProviderDialog
        open={Boolean(models())}
        draft={modelsDraft()}
        discovery={discovery()}
        onDiscoverModels={props.api.discoverModels ? (endpoint) => void discover(endpoint) : undefined}
        busy={saving()}
        submitError={submitError()}
        takenProviderIds={taken(props.takenProviderIds)}
        providerIdLocked={Boolean(models()?.added)}
        apiKeyKept={Boolean(models()?.added && models()?.keyStored)}
        onSubmit={(value) => void save({ kind: "models", value })}
        onCancel={props.onClose}
      />
      <CustomAcpAgentDialog
        open={Boolean(agent())}
        draft={agentDraft()}
        check={check()}
        onCheck={props.api.checkAgent ? (value) => void runCheck(value) : undefined}
        busy={saving()}
        submitError={submitError()}
        takenAgentIds={taken(props.takenAgentIds)}
        editing={Boolean(agent()?.added)}
        onSubmit={(value) => void save({ kind: "agent", value })}
        onCancel={props.onClose}
      />
    </>
  );
}
