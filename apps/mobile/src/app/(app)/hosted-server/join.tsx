import { AddServerLinkScreen } from "@/features/servers/screens/add-server-link-screen";

export default function HostedServerJoin() {
  return <AddServerLinkScreen scanHref="/hosted-server/scan" underHeader />;
}
