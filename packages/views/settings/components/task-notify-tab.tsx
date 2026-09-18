"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentMember } from "@multica/core/permissions";
import { useCurrentWorkspace } from "@multica/core/paths";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { api } from "@multica/core/api";
import type { Workspace } from "@multica/core/types";
import {
  CLAWBOT_CHANNEL,
  CLAWBOT_ENDPOINT,
  deriveTaskNotifySettings,
  mergeTaskNotifySettings,
  type TaskNotifySettings,
} from "@multica/core/task-notify";
import { useT } from "../../i18n";

/**
 * Settings → Integrations → 任务结束推送.
 * Two outbound channels for the same purpose (agent task completed/failed):
 *   1. WeChat service-account URL (user supplies the wxsend-style URL)
 *   2. WeChat ClawBot via PushPlus (endpoint/channel fixed; user supplies token)
 */
export function TaskNotifyTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { member } = useCurrentMember(wsId);
  const canManage = member?.role === "owner" || member?.role === "admin";

  const saved = useMemo(() => deriveTaskNotifySettings(workspace), [workspace]);
  const [draft, setDraft] = useState<TaskNotifySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? saved;
  const dirty = draft !== null;

  function patch(next: TaskNotifySettings) {
    setDraft(next);
  }

  async function persist() {
    if (!workspace || !canManage || saving) return;
    setSaving(true);
    try {
      const merged = mergeTaskNotifySettings(
        (workspace.settings as Record<string, unknown>) ?? {},
        current,
      );
      const updated = await api.updateWorkspace(workspace.id, { settings: merged });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      setDraft(null);
      toast.success(t(($) => $.auto_save.toast_saved), { id: "settings-auto-save" });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.task_notify.toast_failed),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        {t(($) => $.task_notify.intro)}
      </p>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-body">
                {t(($) => $.task_notify.wechat_url_title)}
              </CardTitle>
              <CardDescription>
                {t(($) => $.task_notify.wechat_url_description)}
              </CardDescription>
            </div>
            <Switch
              checked={current.wechat_url.enabled}
              disabled={!canManage}
              onCheckedChange={(enabled) =>
                patch({
                  ...current,
                  wechat_url: { ...current.wechat_url, enabled },
                })
              }
              aria-label={t(($) => $.task_notify.wechat_url_title)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="task-notify-wx-url">
              {t(($) => $.task_notify.url_label)}
            </Label>
            <Input
              id="task-notify-wx-url"
              type="url"
              placeholder="https://example.com/wxsend"
              value={current.wechat_url.url}
              disabled={!canManage}
              onChange={(e) =>
                patch({
                  ...current,
                  wechat_url: { ...current.wechat_url, url: e.target.value },
                })
              }
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.task_notify.url_hint)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-body">
                {t(($) => $.task_notify.clawbot_title)}
              </CardTitle>
              <CardDescription>
                {t(($) => $.task_notify.clawbot_description)}
              </CardDescription>
            </div>
            <Switch
              checked={current.clawbot.enabled}
              disabled={!canManage}
              onCheckedChange={(enabled) =>
                patch({
                  ...current,
                  clawbot: { ...current.clawbot, enabled },
                })
              }
              aria-label={t(($) => $.task_notify.clawbot_title)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t(($) => $.task_notify.endpoint_label)}</Label>
              <Input value={CLAWBOT_ENDPOINT} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label>{t(($) => $.task_notify.channel_label)}</Label>
              <Input value={CLAWBOT_CHANNEL} readOnly disabled />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-notify-claw-token">
              {t(($) => $.task_notify.token_label)}
            </Label>
            <Input
              id="task-notify-claw-token"
              type="password"
              autoComplete="off"
              placeholder={t(($) => $.task_notify.token_placeholder)}
              value={current.clawbot.token}
              disabled={!canManage}
              onChange={(e) =>
                patch({
                  ...current,
                  clawbot: { ...current.clawbot, token: e.target.value },
                })
              }
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.task_notify.clawbot_hint)}
            </p>
          </div>
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button onClick={() => void persist()} disabled={!dirty || saving}>
            {saving
              ? t(($) => $.task_notify.saving)
              : t(($) => $.task_notify.save)}
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              {t(($) => $.task_notify.discard)}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.task_notify.readonly_hint)}
        </p>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-surface-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
        <Bell className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{t(($) => $.task_notify.trigger_hint)}</span>
      </div>
    </div>
  );
}
