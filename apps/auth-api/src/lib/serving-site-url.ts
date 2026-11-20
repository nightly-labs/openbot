import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestUrl } from "@tanstack/solid-start/server";
import { siteUrlForPage } from "./site-metadata";

export const servingSiteUrl = createIsomorphicFn()
  .server(() => siteUrlForPage(getRequestUrl()))
  .client(() => siteUrlForPage(new URL(window.location.href)));
