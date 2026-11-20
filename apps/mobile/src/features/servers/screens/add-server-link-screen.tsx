import { type Href, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { forgetIncomingLink, readIncomingLink } from "@/features/links/model/incoming-links";
import type { LocalServerPathname } from "@/features/servers/components/local-server-options";
import { AddServerScreen } from "./add-server-screen";

interface SheetPlacement {
  scanHref?: Href;
  underHeader?: boolean;
  localServerPathname?: LocalServerPathname;
}

export function AddServerLinkScreen(placement: SheetPlacement = {}) {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <Invitation key={request ?? "manual"} request={request} {...placement} />;
}

function Invitation({ request, ...placement }: { request?: string } & SheetPlacement) {
  const [link] = useState(() => readIncomingLink(request));
  useEffect(() => {
    forgetIncomingLink(request);
  }, [request]);
  return (
    <AddServerScreen
      initialInvite={link.kind === "invite" ? link.url : ""}
      onJoined={() => router.dismissTo("/connected")}
      {...placement}
    />
  );
}
