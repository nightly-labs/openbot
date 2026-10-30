import { Alert, AlertActions, AlertContent, AlertDescription, AlertIcon, AlertTitle, Button, Moon } from "@openbot/ui";
import { useText } from "../../text";
import type { HostedUpsellHost } from "./hosted-server-upsell-host";

export interface HostedServerUpsellNoticeProps {
  /** The active routines that stop when the computer is off. */
  count: number;
  host: HostedUpsellHost;
  onSeePlans: () => void;
  onDismiss: () => void;
}

/**
 * The glow outside the moving border. A mask applies after the filter of the same element, so the
 * blur is on this element and the masked ring is its child.
 */
function HostedUpsellBeamGlow() {
  return (
    <span class="hosted-upsell-beam-glow" aria-hidden="true">
      <span />
    </span>
  );
}

/** The offer of a hosted server at the routine list, while routines depend on a computer. */
export function HostedServerUpsellNotice(props: HostedServerUpsellNoticeProps) {
  const { t } = useText();
  const title = () => {
    const host = props.host;
    return host === "this-computer"
      ? t("server.upsell.notice.title.local", { count: props.count })
      : t("server.upsell.notice.title.remote", { count: props.count, server: host.name });
  };
  return (
    <Alert class="hosted-upsell-notice hosted-upsell-beam" role="status" report={false}>
      <HostedUpsellBeamGlow />
      <AlertIcon>
        <Moon />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{title()}</AlertTitle>
        <AlertDescription>{t("server.upsell.notice.description")}</AlertDescription>
        <AlertActions>
          <Button size="sm" onClick={() => props.onSeePlans()}>
            {t("server.upsell.seePlans")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.onDismiss()}>
            {t("server.upsell.notNow")}
          </Button>
        </AlertActions>
      </AlertContent>
    </Alert>
  );
}
