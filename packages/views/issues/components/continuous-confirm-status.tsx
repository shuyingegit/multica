"use client";

import { useMemo, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Progress } from "@multica/ui/components/ui/progress";
import { api } from "@multica/core/api";
import { issueKeys, issueTasksOptions } from "@multica/core/issues";
import { useWorkspaceId } from "@multica/core/hooks";
import type { Issue } from "@multica/core/types";
import { useT } from "../../i18n";
import {
  CONTINUOUS_CONFIRM_META,
  parseContinuousConfirmPlan,
} from "../lib/continuous-confirm";

type Props = {
  issue: Issue;
};

/** Live progress / stop controls for an active continuous-confirm plan. */
export function ContinuousConfirmStatus({ issue }: Props) {
  const { t } = useT("issues");
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  const plan = parseContinuousConfirmPlan(issue.metadata);
  const [stopping, setStopping] = useState(false);
  const { data: tasks } = useQuery(issueTasksOptions(issue.id));

  const activeTask = useMemo(() => {
    if (!tasks?.length) return false;
    return tasks.some((task) => {
      const s = task.status;
      return (
        s === "running" ||
        s === "queued" ||
        s === "dispatched" ||
        s === "deferred" ||
        s === "waiting_local_directory"
      );
    });
  }, [tasks]);

  const stopMutation = useMutation({
    mutationFn: async () => {
      const keys = Object.values(CONTINUOUS_CONFIRM_META);
      for (const key of keys) {
        try {
          await api.deleteIssueMetadataKey(issue.id, key);
        } catch {
          /* key may already be gone */
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issue.id) });
    },
    onSettled: () => setStopping(false),
  });

  if (!plan) return null;

  const closed = issue.status === "done" || issue.status === "cancelled";
  const displayRound = plan.rounds > 0 ? plan.rounds : activeTask ? 1 : 0;
  const pct = plan.max > 0 ? Math.min(100, Math.round((displayRound / plan.max) * 100)) : 0;

  let statusLabel = t(($) => $.comment.continuous_confirm_running);
  if (plan.waiting) {
    statusLabel = t(($) => $.comment.continuous_confirm_waiting);
  } else if (closed) {
    statusLabel = t(($) => $.comment.continuous_confirm_stalled_done);
  } else if (!activeTask) {
    statusLabel = t(($) => $.comment.continuous_confirm_stalled);
  } else if (plan.rounds <= 0) {
    statusLabel = t(($) => $.comment.continuous_confirm_first_round);
  }

  return (
    <div
      className="mb-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-caption"
      data-testid="continuous-confirm-status"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium text-foreground">
            {t(($) => $.comment.continuous_confirm_progress, {
              current: displayRound,
              max: plan.max,
            })}
            <span className="ml-1.5 font-normal text-muted-foreground">· {statusLabel}</span>
          </div>
          <p className="truncate text-muted-foreground" title={plan.doneMarker}>
            {t(($) => $.comment.continuous_confirm_done_hint, { marker: plan.doneMarker })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={stopping || stopMutation.isPending}
          onClick={() => {
            setStopping(true);
            stopMutation.mutate();
          }}
        >
          {stopping || stopMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Square className="size-3.5" />
          )}
          {t(($) => $.comment.continuous_confirm_stop)}
        </Button>
      </div>
      <Progress value={pct} className="mt-2 w-full" />
    </div>
  );
}
