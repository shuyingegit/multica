"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentMember } from "@multica/core/permissions";
import { useCurrentWorkspace } from "@multica/core/paths";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { api } from "@multica/core/api";
import type { Workspace } from "@multica/core/types";
import {
  browserAppBaseUrl,
  deriveTaskNotifySettings,
  isLoopbackAppBaseUrl,
  mergeTaskNotifySettings,
} from "@multica/core/task-notify";

/**
 * Stamps workspace.settings.task_notify.app_base_url from the real browser
 * origin whenever an owner/admin browses the app. Push deep links then use
 * that public host:port instead of server-side localhost env.
 */
export function TaskNotifyAppBaseSync() {
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { member } = useCurrentMember(wsId);
  const canManage = member?.role === "owner" || member?.role === "admin";
  const savedAppBase = workspace
    ? deriveTaskNotifySettings(workspace).app_base_url
    : "";
  const inFlight = useRef(false);

  useEffect(() => {
    if (!workspace || !canManage || inFlight.current) return;
    const origin = browserAppBaseUrl();
    if (!origin || isLoopbackAppBaseUrl(origin)) return;
    if (savedAppBase === origin) return;

    inFlight.current = true;
    const next = {
      ...deriveTaskNotifySettings(workspace),
      app_base_url: origin,
    };
    const merged = mergeTaskNotifySettings(
      (workspace.settings as Record<string, unknown>) ?? {},
      next,
    );
    void api
      .updateWorkspace(workspace.id, { settings: merged })
      .then((updated) => {
        qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
          old?.map((ws) => (ws.id === updated.id ? updated : ws)),
        );
      })
      .catch(() => {
        // Silent: push links still fall back to env until the next successful stamp.
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [workspace, canManage, qc, savedAppBase]);

  return null;
}
