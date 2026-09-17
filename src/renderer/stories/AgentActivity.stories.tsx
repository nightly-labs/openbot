import { createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentActivityIndicator } from "../src/features/conversation/AgentActivity";
import { STORY_AGENTS } from "./fixtures";

const indicatorMeta = {
  title: "Conversation/AgentActivityIndicator",
  component: AgentActivityIndicator,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentActivityIndicator>;

export default indicatorMeta;
type IndicatorStory = StoryObj<typeof indicatorMeta>;

export const Working: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[0],
    presentation: { animation: "orbit", label: "Connecting the dots…" },
  },
};

export const Playful: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[1],
    presentation: { animation: "comet", label: "Tiny gears are turning…" },
  },
};

// The desktop app icon, scaled down and inlined so the story needs no network.
// It stands in for an agent’s uploaded avatar: the circular crop, the rings
// flying around it and the dot swap are what these stories are for.
const CUSTOM_AVATAR =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAYKADAAQAAAABAAAAYAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAYABgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICBAICBAYEBAQGCAYGBgYICggICAgICgwKCgoKCgoMDAwMDAwMDA4ODg4ODhAQEBAQEhISEhISEhISEv/bAEMBAwMDBQQFCAQECBMNCw0TExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE//dAAQABv/aAAwDAQACEQMRAD8A/efWdasNBsH1HUX2ovQd2PoB6182eIfinr+qytHpzm0g5ACH5iPduufpik+KfiGXVfED6fG37i0JQAHgt/Efrnj8BXmFfXZXlcIQVWqryf4Hs4TCxjFTmtWWbq9u76TzbyVpWxjLkk/marUUV7iVtEd4UUUUwCiiigAqza3t3YyebZytE2MZQkH8xVaik1fRgeoeHvinr+lSrHqLm7g4BDn5gPZuufrmvpPRtasNesE1HTn3I3Ud1PoR618OV6f8LPEMuleIE0+Rv3F2QhBPAb+E/XPH4mvDzTK4Tg6tJWkvxODF4WMoucFqj//Q/Q29upL67lvJcbpWLnHqTk1Woor9KStoj6gKKUAk4HNZGm6/oOsm5Gj31vd/Y3MVx5EqSeU45KybSdrDuDg0XA1qKQMrKGUggjII5BFLTAKKKUAngUAJRXLWvjrwPfXUdjZa1YTTzSvBHHHcxM7yx8uiqGJLL3UciuppJp7CTvsFWbK6ksbuK8ixuiYOM+oORVaihq+jGf/R/QSlVSzBR3pK+cv2sovE83wF1weFNft/DU4RTNe3LtEgt84ljEiqzK8gO1dqlj90cnNfo9WfJFztsfTSlyps/I39pP8Abm+LfxG1PUPBXhov4Y0aGWS3khgY/apgjFSJphggHHKJgdiW618deFPEviGzsrvwhaa1JpGk6s0bahtZwkixbtu9U+aTG5sJ0JPPqOPu47eK5eK0k86NSQsm0ruHrg8jPvzVevhquInVlzzd2fPzqyk+aTP1N+B/7eNj4F1jw18LYoEtfA2lRG2uL/UPMlv3X5m83ERZUw5wsSq+F43cZH7R6dqNjq+nW+raXKs9tdRJNDInKvHIoZWHsQQRX8h9f0pfsTaj4j1P9mXwzN4nD+dHFJFC7yCVpLdJGETEj7uF+UKeQFH0r3snxk6knRn20/yPRwVeUm4SPpLxBr+j+FdDu/EniC4jtLKyiaaaWVgiqqjJyWwOeg9TxX8+vx//AG5/iv8AGcz6Dokh8O+H5Mr9ltXPnTJ/03mGGbI6ou1OxB61+kH/AAUm8VXGgfs9Jotu8ajWtRgt5FdCzNHGGmOwjhSHRDk9sgV+AxBU7WGCOxrLOcXNT9hB2VtSMdWkn7OLFjd4XEsLFGU5BU4IPsRX6ZfsifteP8H7CPwz8WNYutU027MNtp9lEFmaxUud00kjFdqHdgRhmbHOFAGfzLpQCx2gZJ7V41CvKhLnp7nDTqOm+aJ/X0rI6h42DKRkMpyCD0IPcGlrw79mqbxHN8B/CyeKtJbRLuGxjh+yMzMyxRfJEx3ksC8YVyGORnFe4191TlzxUu59DF3SZ//S/QSvmz9rf4cRfE74C65oq2U2oXdpH9us4IJPKdp4QdvJBDAKzEqR83QYOCPpOjrwa/R6tNVIuEup9NKPMnFn8gdFft7+0b/wTu0fxrfy+LPgs8WmalfXayXNpcOIrJIipDmBY4yVO7DFTkdduOlfPnxU/wCCefjvwnpGheHfhfaf8JJf6iz/ANp6lI6Qx2zKV2IkbMNkRBJaQ7mbGBt+6fkKuWV4N+7dI8WeEqRvofnZ4L8MyeNPF2m+EYbqGyfUrmO2We4YrFGZGChnIBOBmv6gfgt8JNC+B3w4sPhv4ekknistzSTS/elmkO6R8dFBboo6DA5PJ+Rf2eP+CfPgP4XXNr4u+JEy+Iddt2WWOMArZ28inIKqcNKynoz4Geid6/Q8kk5Ne3lWBlQTqVVq/wAjvweHdNOU1qfMH7Y2keKdW/Z419/BywG9soxdkzxCVhDD80phBVts2zO1gMjnBB5H80kjSO5eUksxySepJ7mv6+a/M79o39gqw8ULrHjf4QoJvEmtXyzyxX8wW3hik3Gb7ONoCsWKkby21chMHFZ5rgJ1mqtPW3QnGYeU/fifhpViztbq+u47OxjeaaVgqRxqWdmJwAqjkk9gK+8PCH/BOn4+a743uPDfiOKDSNNtJNsmpu4kilX+9bouHkyOm4IB/EQeK/XT4Gfsq/CL4B2yT+FrL7Xq23Emp3YD3Bz12cbYlPogHuTXl4bKq1V+8uVeZx0sHOb10R6F8GPAy/DX4VaD4IW5uLv7BaIplu+JSz5kZWGTt2lioXJ2gAZOM16dRRX10IqKUV0PaSsrI//T/QSirN7ayWN3LZy43RMUOPUHBqtX6UnfVH1AUUUUwCiiigAooooAKKKKACiirNlayX13FZxY3SsEGfUnApN21YH/1P1T+Kfh6XSvED6hGv7i7JcEDgN/EPrnn8RXmFfces6LYa9YPp2opuRuh7qfUH1r5s8Q/CzX9KlaTTkN3ByQUHzAe69c/TNfXZXmkJwVKq7SX4ns4TFRlFQm9UeX0VZurK7sZPKvImibGcOCD+RqtXuJ31R3hRRRTAKKKKACiirNrZXd9J5VnE0rYzhASfyFJu2rArV6f8LPD0uq+IE1CRf3FoQ5JHBb+EfXPP4Gl8PfCzX9VlWTUUNpBwSXHzEey9c/XFfSejaLYaDYJp2nJtRep7sfUn1rw80zSEIOlSd5P8DgxeKjGLhB6s//2Q==";

export const CustomImage: IndicatorStory = {
  args: {
    agent: { ...STORY_AGENTS[0], avatarUrl: CUSTOM_AVATAR },
    presentation: { animation: "orbit", label: "Connecting the dots…" },
  },
};

export const CustomImageThinking: IndicatorStory = {
  args: {
    agent: { ...STORY_AGENTS[0], avatarUrl: CUSTOM_AVATAR },
    presentation: { animation: "thinking", label: "Thinking it through…" },
  },
};

/**
 * `wide` carries its motion in the face, and `burst` in the body — the two parts a
 * photo replaces. Rather than stand still for the whole turn, they borrow the orbit
 * rings, so this reads like `CustomImage` while the Bloub plays its own pose.
 */
export const CustomImageBorrowedRings: IndicatorStory = {
  args: {
    agent: { ...STORY_AGENTS[0], avatarUrl: CUSTOM_AVATAR },
    presentation: { animation: "wide", label: "Putting the answer together…" },
  },
};

/**
 * An avatar the renderer cannot resolve — a revoked file, a stale `?v=` version.
 * The Bloub takes over rather than leaving a broken image in the transcript.
 */
export const CustomImageUnavailable: IndicatorStory = {
  args: {
    agent: { ...STORY_AGENTS[0], avatarUrl: "openbot-avatar://agent/chief?v=missing" },
    presentation: { animation: "orbit", label: "Connecting the dots…" },
  },
};

export const TransitionLoop: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[0],
    presentation: { animation: "wide", label: "Putting the answer together…" },
  },
  render: (args) => {
    const [phase, setPhase] = createSignal<"active" | "exiting">("active");
    onSettled(() => {
      const timer = window.setInterval(
        () => setPhase((current) => (current === "active" ? "exiting" : "active")),
        1_400,
      );
      return () => window.clearInterval(timer);
    });
    return <AgentActivityIndicator {...args} phase={phase()} />;
  },
};
