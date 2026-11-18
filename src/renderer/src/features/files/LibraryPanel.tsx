import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { desktopAgentLevels } from "../conversation/message-delete-access";
import { useServers } from "../servers/servers-context";
import { filesPort } from "./files-port";
import { ServerLibrary } from "./ServerLibrary";

/**
 * The Library page of the desktop window: every file and picture of the selected server's chats. A
 * file that the app can show opens in the file viewer over the page; any other file opens in its app.
 */
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
