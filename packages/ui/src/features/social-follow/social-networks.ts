/** The networks of the social toast, in the order it shows them. */
export const SOCIAL_NETWORK_IDS = ["x", "threads", "linkedin", "reddit", "instagram", "tiktok", "facebook"] as const;

export type SocialNetworkId = (typeof SOCIAL_NETWORK_IDS)[number];

export interface SocialNetwork {
  id: SocialNetworkId;
  /** The brand name. It is not translated. */
  name: string;
  /** The OpenBot account on the network, as its users write it. */
  handle: string;
  /** A profile takes a follow; a community takes a join. */
  kind: "profile" | "community";
  /** `text`: the post page opens with the first post. `link`: with the OpenBot link only. `copy`: the page takes nothing, so the app copies the post first. */
  compose: "text" | "link" | "copy";
}

export const SOCIAL_NETWORKS: Record<SocialNetworkId, SocialNetwork> = {
  x: { id: "x", name: "X", handle: "@OpenBot_", kind: "profile", compose: "text" },
  threads: { id: "threads", name: "Threads", handle: "@openbot.run", kind: "profile", compose: "text" },
  linkedin: { id: "linkedin", name: "LinkedIn", handle: "OpenBot", kind: "profile", compose: "link" },
  reddit: { id: "reddit", name: "Reddit", handle: "r/OpenBot_", kind: "community", compose: "text" },
  instagram: { id: "instagram", name: "Instagram", handle: "@openbot.run", kind: "profile", compose: "copy" },
  tiktok: { id: "tiktok", name: "TikTok", handle: "@openbot.run", kind: "profile", compose: "copy" },
  facebook: { id: "facebook", name: "Facebook", handle: "OpenBot", kind: "profile", compose: "link" },
};
