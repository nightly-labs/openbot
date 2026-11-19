import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function ServerSettingsLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack screenListeners={sheetBackHaptics} screenOptions={sheetStackOptions(background)}>
      <Stack.Screen name="index" options={{ title: t("mobile.server.route.settings") }} />
      <Stack.Screen name="members" options={{ title: t("mobile.app.route.members") }} />
      <Stack.Screen name="invite" options={{ title: t("mobile.server.route.invite") }} />
      <Stack.Screen name="member" options={{ title: t("mobile.server.route.member") }} />
      <Stack.Screen name="member-roles" options={{ title: t("mobile.server.roles.title") }} />
      <Stack.Screen name="roles" options={{ title: t("mobile.server.route.roles") }} />
      <Stack.Screen name="role" options={{ title: t("mobile.server.route.role") }} />
      <Stack.Screen name="audit" options={{ title: t("mobile.server.route.audit") }} />
      <Stack.Screen name="timezone" options={{ title: t("mobile.server.route.timezone") }} />
      <Stack.Screen name="agent-limit" options={{ title: t("mobile.server.route.agentLimit") }} />
      <Stack.Screen name="agents" options={{ title: t("mobile.server.route.agents") }} />
      <Stack.Screen name="connector" options={{ title: t("mobile.server.route.connectors") }} />
      <Stack.Screen
        name="github-repositories"
        options={{ title: t("mobile.server.connectors.github.repositoriesTitle") }}
      />
      <Stack.Screen name="whatsapp-link" options={{ title: t("mobile.server.connectors.whatsapp.linkTitle") }} />
      <Stack.Screen name="whatsapp-contact" options={{ title: t("mobile.server.connectors.whatsapp.contactTitle") }} />
      <Stack.Screen name="whatsapp-group" options={{ title: t("mobile.server.connectors.whatsapp.groupTitle") }} />
      <Stack.Screen name="updates" options={{ title: t("mobile.server.route.updates") }} />
      <Stack.Screen name="storage" options={{ title: t("mobile.server.route.storage") }} />
      <Stack.Screen name="storage-files" options={{ title: t("mobile.server.route.storageFiles") }} />
      <Stack.Screen name="sites" options={{ title: t("mobile.server.route.sites") }} />
      <Stack.Screen name="providers" options={{ title: t("mobile.server.route.providers") }} />
      <Stack.Screen name="provider" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="provider-models" options={{ title: t("mobile.server.route.providerModels") }} />
      <Stack.Screen name="provider-key" options={{ title: t("mobile.server.providers.apiKey") }} />
      <Stack.Screen name="provider-sign-in" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="provider-account" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="acp-registry" options={{ title: t("mobile.server.route.acpRegistry") }} />
      <Stack.Screen name="custom-agent" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="custom-provider" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="provider-environment" options={{ title: t("mobile.server.environment.title") }} />
      <Stack.Screen name="mcp-server" options={{ title: t("mobile.server.route.mcpServer") }} />
      <Stack.Screen name="mcp-server-agents" options={{ title: t("mobile.server.mcp.access.agents") }} />
      <Stack.Screen name="crop-logo" options={{ title: t("mobile.server.route.cropLogo") }} />
      <Stack.Screen name="vault" options={{ title: t("mobile.server.route.vault") }} />
      <Stack.Screen name="vault-item" options={{ title: t("mobile.server.route.vault") }} />
      <Stack.Screen name="vault-item-agents" options={{ title: t("mobile.server.vault.agents") }} />
      <Stack.Screen name="vault-two-step" options={{ title: t("mobile.server.vault.twoStep.setupTitle") }} />
      <Stack.Screen name="vault-two-step-scan" options={{ title: t("mobile.server.vault.twoStep.scan") }} />
      <Stack.Screen name="vault-two-step-check" options={{ title: t("mobile.server.vault.twoStep.checkTitle") }} />
      <Stack.Screen name="import" options={{ title: t("mobile.server.route.import") }} />
      <Stack.Screen name="import-guide" options={{ title: t("mobile.server.route.import") }} />
      <Stack.Screen name="transfer" options={{ title: t("mobile.server.route.transfer") }} />
      <Stack.Screen name="transfer-export" options={{ title: t("mobile.server.route.transferExport") }} />
      <Stack.Screen name="transfer-import" options={{ title: t("mobile.server.route.transferImport") }} />
      <Stack.Screen name="transfer-copy" options={{ title: t("mobile.server.route.transferCopy") }} />
      <Stack.Screen name="browser-profiles" options={{ title: t("mobile.server.route.browserProfiles") }} />
      <Stack.Screen name="browser-profile" options={{ title: t("mobile.server.route.browserProfiles") }} />
      <Stack.Screen name="browser-profile-agents" options={{ title: t("mobile.server.browserProfiles.agentsTitle") }} />
      <Stack.Screen name="browser-profile-proxy" options={{ title: t("mobile.server.browserProxies.menu") }} />
      <Stack.Screen name="browser-proxy" options={{ title: t("mobile.server.browserProxies.title") }} />
    </Stack>
  );
}
