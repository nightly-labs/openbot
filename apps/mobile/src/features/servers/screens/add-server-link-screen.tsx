import { type Href, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { forgetIncomingLink, readIncomingLink } from "@/features/links/model/incoming-links";
import { AddServerScreen } from "./add-server-screen";

interface SheetPlacement {
  /** The scanner page of the sheet that shows this page. */
  scanHref?: Href;
  /** An inner page under a native header. */
  underHeader?: boolean;
}

export function AddServerLinkScreen(placement: SheetPlacement = {}) {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <Invitation key={request ?? "manual"} request={request} {...placement} />;
}

// A deep link and the scanner both hand over the invitation through the request store, so its
// one-use token never enters navigation params.
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
