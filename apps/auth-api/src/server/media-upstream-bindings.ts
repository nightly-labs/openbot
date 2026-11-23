import {
  type MediaUpstream,
  type MediaUpstreamOptions,
  type MediaUpstreams,
  ROUTER_MEDIA_UPSTREAM,
  RouterMediaUpstream,
  TASKS_MEDIA_UPSTREAM,
} from "./media-upstream";
import { TasksMediaUpstream } from "./media-upstream-tasks";

export interface MediaUpstreamBindings {
  MEDIA_API_URL?: string | undefined;
  MEDIA_API_KEY?: string | undefined;
  MEDIA_API_TASKS_URL?: string | undefined;
  MEDIA_API_TASKS_KEY?: string | undefined;
}

function options(baseUrl: string | undefined, apiKey: string | undefined): MediaUpstreamOptions | null {
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, fetch: (input, init) => fetch(input, init) };
}

export function mediaUpstreamsFromBindings(bindings: MediaUpstreamBindings): MediaUpstreams {
  const upstreams = new Map<string, MediaUpstream>();
  const router = options(bindings.MEDIA_API_URL, bindings.MEDIA_API_KEY);
  if (router) upstreams.set(ROUTER_MEDIA_UPSTREAM, new RouterMediaUpstream(router));
  const tasks = options(bindings.MEDIA_API_TASKS_URL, bindings.MEDIA_API_TASKS_KEY);
  if (tasks) upstreams.set(TASKS_MEDIA_UPSTREAM, new TasksMediaUpstream(tasks));
  return upstreams;
}
