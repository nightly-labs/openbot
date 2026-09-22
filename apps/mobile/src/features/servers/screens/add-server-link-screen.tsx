import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { forgetIncomingLink, readIncomingLink } from "@/features/links/model/incoming-links";
import { AddServerScreen } from "./add-server-screen";

export function AddServerLinkScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <Invitation key={request ?? "manual"} request={request} />;
}

// A deep link and the scanner both hand over the invitation through the request store, so its
// one-use token never enters navigation params.
function Invitation({ request }: { request?: string }) {
  const [link] = useState(() => readIncomingLink(request));
  useEffect(() => {
    forgetIncomingLink(request);
  }, [request]);
  return (
    <AddServerScreen
      initialInvite={link.kind === "invite" ? link.url : ""}
      onJoined={() => router.dismissTo("/connected")}
    />
  );
}
