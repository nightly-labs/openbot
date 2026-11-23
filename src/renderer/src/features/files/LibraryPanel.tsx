import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { desktopAgentLevels } from "../conversation/message-delete-access";
import { useServers } from "../servers/servers-context";
import { filesPort } from "./files-port";
import { ServerLibrary } from "./ServerLibrary";

export function LibraryPanel(props: { serverId: string }) {
  const { servers } = useServers();
  const navigation = useNavigation();
  return (
    <ServerLibrary
      serverId={props.serverId}
      server={servers().find((candidate) => candidate.id === props.serverId)}
      calls={filesPort}
      levels={desktopAgentLevels}
      onShowInChat={navigation.selectGlobalSearchMessage}
      onOpenUrl={(url) => void appPort().openUrl(url)}
    />
  );
}
