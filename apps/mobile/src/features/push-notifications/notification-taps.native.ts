import { isString } from "@openbot/contracts/runtime-values";
import type { PushNotificationKind } from "@openbot/team-client/push-notification-seal";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { type NotificationTarget, SOUND_PREVIEW_KEY, type WorkflowTarget } from "./push-notifications-native.types";

export function installNotificationHandler(): void {
  Notifications.setNotificationHandler(null);
}

const WORKFLOW_KIND: PushNotificationKind = "workflow";

let handled: string | null = null;

export function useNotificationTaps(
  open: (target: NotificationTarget) => void,
  onScreen: (target: NotificationTarget) => boolean,
  openWorkflow: (target: WorkflowTarget) => void,
): void {
  const response = Notifications.useLastNotificationResponse();
  const openRef = useRef(open);
  openRef.current = open;
  const openWorkflowRef = useRef(openWorkflow);
  openWorkflowRef.current = openWorkflow;
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        if (notification.request.content.data?.[SOUND_PREVIEW_KEY] === true) {
          return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
        }
        const target = notificationTarget(notification);
        const shown = target !== null && onScreenRef.current(target);
        return { shouldShowBanner: !shown, shouldShowList: !shown, shouldPlaySound: !shown, shouldSetBadge: false };
      },
    });
    return () => Notifications.setNotificationHandler(null);
  }, []);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const identifier = response.notification.request.identifier;
    if (handled === identifier) return;
    handled = identifier;
    const workflow = workflowTarget(response.notification);
    if (workflow) {
      openWorkflowRef.current(workflow);
      return;
    }
    const target = notificationTarget(response.notification);
    if (target) openRef.current(target);
  }, [response]);
}

function workflowTarget(notification: Notifications.Notification): WorkflowTarget | null {
  const data = notification.request.content.data;
  const serverId = data?.serverId;
  const workflowId = data?.agentId;
  if (data?.kind !== WORKFLOW_KIND || !isString(serverId) || !serverId) return null;
  return isString(workflowId) && workflowId ? { serverId, workflowId } : null;
}

function notificationTarget(notification: Notifications.Notification): NotificationTarget | null {
  const data = notification.request.content.data;
  if (data?.kind === WORKFLOW_KIND) return null;
  const agentId = data?.agentId;
  if (!isString(agentId) || !agentId) return null;
  const serverId = data?.serverId;
  const threadId = data?.threadId;
  return {
    agentId,
    serverId: isString(serverId) && serverId ? serverId : null,
    threadId: isString(threadId) && threadId ? threadId : null,
  };
}
