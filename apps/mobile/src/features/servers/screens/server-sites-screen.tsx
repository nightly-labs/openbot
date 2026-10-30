import type { HostedSiteSummary } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { useServerSites } from "@/features/servers/model/use-server-sites";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

const DATE_FORMAT = { year: "numeric", month: "short", day: "numeric" } as const;

function httpsLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Server sheet > Sites: the openbot.site sites that agents on the server published. Every member
 * opens a site; an owner or admin also deletes it, as on desktop.
 */
export function ServerSitesScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const { available, canDelete, query, remove } = useServerSites(serverId);
  const locked = useRef(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const server = servers.find((item) => item.id === serverId);
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  if (!available)
    return (
      <SettingsContent>
        <SettingsNote>
          {t(showsOnline(server) ? "mobile.server.sites.unsupported" : "mobile.server.sites.offline")}
        </SettingsNote>
      </SettingsContent>
    );
  const list = query.data;

  function openSite(site: HostedSiteSummary) {
    const failed = () => {
      void haptics.notification("error");
      setError(currentText().t("mobile.server.sites.openFailed"));
    };
    // The host sends the URL. Open only a web page, never another scheme or an app link.
    const url = httpsLink(site.url);
    if (!url) return failed();
    void Linking.openURL(url).catch(failed);
  }

  function deleteSite(site: HostedSiteSummary) {
    if (locked.current) return;
    locked.current = true;
    setDeleting(site.id);
    setError(null);
    remove(site.id)
      .then(() => void haptics.notification("success"))
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        setError(text.errorMessage(cause, text.t("mobile.server.sites.deleteFailed")));
      })
      .finally(() => {
        locked.current = false;
        setDeleting(null);
      });
  }

  function confirmDelete(site: HostedSiteSummary) {
    void haptics.notification("warning");
    Alert.alert(
      t("mobile.server.sites.deleteTitle", { hostname: site.hostname }),
      t("mobile.server.sites.deleteDescription"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => deleteSite(site) },
      ],
    );
  }

  function chooseSite(site: HostedSiteSummary) {
    const active = site.status === "active";
    if (!canDelete) {
      if (active) openSite(site);
      return;
    }
    Alert.alert(site.title, site.hostname, [
      ...(active ? [{ text: t("common.open"), onPress: () => openSite(site) }] : []),
      { text: t("common.delete"), style: "destructive" as const, onPress: () => confirmDelete(site) },
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  }

  return (
    <SettingsContent>
      <SettingsSection
        title={list ? t("mobile.server.sites.usage", { used: list.used, count: list.limit }) : undefined}
        footer={
          error ??
          (query.isError
            ? errorMessage(query.error, t("mobile.server.sites.loadFailed"))
            : t("mobile.server.sites.expiryNote"))
        }
      >
        {query.isPending && !query.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.sites.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list?.sites.map((site) => (
          <SettingsRow
            key={site.id}
            disclosure={false}
            disabled={deleting !== null || (!canDelete && site.status !== "active")}
            supportingText={
              site.serverId === null ? `${site.hostname} · ${t("mobile.server.sites.unlinked")}` : site.hostname
            }
            trailing={
              <Typography.Paragraph
                type="body-xs"
                className={site.status === "blocked" ? "text-danger-text" : "text-grouped-secondary"}
              >
                {site.status === "blocked"
                  ? t("mobile.server.sites.blocked")
                  : site.expiresAt
                    ? t("mobile.server.sites.expires", { date: format.date(new Date(site.expiresAt), DATE_FORMAT) })
                    : null}
              </Typography.Paragraph>
            }
            onPress={() => chooseSite(site)}
          >
            <Typography.Paragraph numberOfLines={1}>{site.title}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {list?.sites.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.sites.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {query.isError ? (
          <SettingsRow disclosure={false} disabled={query.isFetching} onPress={() => void query.refetch()}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.sites.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
