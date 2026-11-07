import { agentProviderDescriptor } from "@openbot/contracts/ipc";
import { ProviderCodeLoginDialog } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { ProviderUseAppDialog } from "@openbot/ui/components/ProviderUseAppDialog";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { ProviderCodeLoginOpener, ProviderConnectionApi } from "./provider-connection-api";

/**
 * The dialogs that a provider row's Connect and ⋯ menu open: the sign-in, and the hand-off to the
 * app. With `opener`, only a sign-in that this surface started.
 */
export function ProviderSignInDialogs(props: {
  api: ProviderConnectionApi | undefined;
  opener?: ProviderCodeLoginOpener | undefined;
}) {
  const { t } = useText();
  const shown = (opener: ProviderCodeLoginOpener | null) => props.opener === undefined || opener === props.opener;
  const provider = () => {
    const api = props.api;
    return api && shown(api.opener()) ? api.provider() : null;
  };
  const useApp = () => {
    const handOff = props.api?.openAppDownload ? props.api.useApp() : null;
    return handOff && shown(handOff.opener) ? handOff.provider : null;
  };
  return (
    <>
      <Show when={props.api && provider() ? props.api : undefined}>
        {(api) => (
          <ProviderCodeLoginDialog
            open={true}
            providerName={agentProviderDescriptor(provider() ?? "codex").displayName}
            state={api().state()}
            onOpenVerificationUrl={api().openVerificationUrl}
            onCancel={api().cancel}
            setupStep={provider() === "codex" ? t("provider.codeLogin.chatgptDeviceSetting") : undefined}
            onSubmitCode={api().submit}
            onOpenRelayPage={api().openRelayPage}
            onPasteRelayAddress={api().pasteRelayAddress}
          />
        )}
      </Show>
      <Show when={useApp()}>
        {(useApp) => (
          <ProviderUseAppDialog
            open={true}
            providerName={agentProviderDescriptor(useApp()).displayName}
            onDownload={() => props.api?.openAppDownload?.()}
            onClose={() => props.api?.closeUseApp()}
          />
        )}
      </Show>
    </>
  );
}
