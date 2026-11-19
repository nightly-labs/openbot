import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ContactPage } from "../components/contact/ContactPage";

export const Route = createFileRoute("/_contact")({
  component: ContactLayout,
});

function ContactLayout() {
  const english = useMatch({ from: "/_contact/contact", shouldThrow: false, select: (match) => match.loaderData });
  const polish = useMatch({ from: "/_contact/pl/contact", shouldThrow: false, select: (match) => match.loaderData });
  const portuguese = useMatch({
    from: "/_contact/pt/contact",
    shouldThrow: false,
    select: (match) => match.loaderData,
  });
  const page = () => english() ?? polish() ?? portuguese();
  return (
    <>
      <Show when={page()}>{(data) => <ContactPage lang={data().lang} text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
