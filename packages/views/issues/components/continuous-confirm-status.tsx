"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Play, Square } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Progress } from "@multica/ui/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { api } from "@multica/core/api";
import { issueKeys, issueTasksOptions } from "@multica/core/issues";
import { useWorkspaceId } from "@multica/core/hooks";
import type { Issue } from "@multica/core/types";
import { toast } from "sonner";
import { useT } from "../../i18n";
import {
  CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
  CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
  CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
  clampContinuousConfirmMax,
  parseContinuousConfirmPlan,
  renderContinuousConfirmPrompt,
  saveContinuousConfirmDraft,
} from "../lib/continuous-confirm";

type Props = {
  issue: Issue;
};

/** Live progress + clickable editor for the continuous-confirm plan. */
export function ContinuousConfirmStatus({ issue }: Props) {
  const { t } = useT("issues");
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  const plan = parseContinuousConfirmPlan(issue.metadata);
  const [open, setOpen] = useState(false);
  const [max, setMax] = useState(20);
  const [prompt, setPrompt] = useState(CONTINUOUS_CONFIRM_DEFAULT_PROMPT);
  const [doneMarker, setDoneMarker] = useState(CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER);
  const [brief, setBrief] = useState("");
  const { data: tasks } = useQuery(issueTasksOptions(issue.id));

  useEffect(() => {
    if (!plan || !open) return;
    setMax(plan.max);
    setPrompt(plan.prompt);
    setDoneMarker(plan.doneMarker);
    setBrief(plan.brief);
  }, [plan, open]);

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

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issue.id) });
    void qc.invalidateQueries({ queryKey: issueKeys.tasks(issue.id) });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateContinuousConfirmPlan(issue.id, {
        max: clampContinuousConfirmMax(max),
        prompt: prompt.trim() || CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
        done_marker: doneMarker.trim() || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
        brief: brief.trim(),
        enabled: true,
      }),
    onSuccess: (next) => {
      saveContinuousConfirmDraft({
        max: next.max,
        prompt: next.prompt,
        doneMarker: next.done_marker,
      });
      toast.success(t(($) => $.comment.continuous_confirm_saved));
      invalidate();
      setOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t(($) => $.comment.continuous_confirm_save_failed));
    },
  });

  const fireMutation = useMutation({
    mutationFn: () => api.fireContinuousConfirmPlan(issue.id),
    onSuccess: (res) => {
      toast.success(
        res.mode === "steered"
          ? t(($) => $.comment.continuous_confirm_fired_steer)
          : res.mode === "deferred"
            ? t(($) => $.comment.continuous_confirm_fired_deferred)
            : t(($) => $.comment.continuous_confirm_fired_enqueue),
      );
      invalidate();
      setOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t(($) => $.comment.continuous_confirm_fire_failed));
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopContinuousConfirmPlan(issue.id),
    onSuccess: () => {
      toast.success(t(($) => $.comment.continuous_confirm_stopped));
      invalidate();
      setOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t(($) => $.comment.continuous_confirm_stop_failed));
    },
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

  const busy = saveMutation.isPending || fireMutation.isPending || stopMutation.isPending;

  return (
    <>
      <button
        type="button"
        className="mb-2 w-full rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-left text-caption hover:bg-muted/70 transition-colors"
        data-testid="continuous-confirm-status"
        onClick={() => setOpen(true)}
        title={t(($) => $.comment.continuous_confirm_edit_hint)}
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
            <p className="truncate text-muted-foreground">
              {plan.brief
                ? t(($) => $.comment.continuous_confirm_brief_preview, {
                    brief: plan.brief.replace(/\s+/g, " ").slice(0, 80),
                  })
                : t(($) => $.comment.continuous_confirm_done_hint, { marker: plan.doneMarker })}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            <Pencil className="size-3.5" />
            {t(($) => $.comment.continuous_confirm_edit)}
          </span>
        </div>
        <Progress value={pct} className="mt-2 w-full pointer-events-none" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(($) => $.comment.continuous_confirm_settings)}</DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.comment.continuous_confirm_plan_help)}
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-live-max">{t(($) => $.comment.continuous_confirm_max)}</Label>
              <Input
                id="cc-live-max"
                type="number"
                min={Math.max(plan.max, plan.rounds || 1)}
                max={CONTINUOUS_CONFIRM_ABSOLUTE_MAX}
                value={max}
                onChange={(e) => {
                  const next = clampContinuousConfirmMax(Number(e.target.value));
                  setMax(Math.max(next, plan.max, plan.rounds || 1));
                }}
              />
              <p className="text-caption text-muted-foreground">
                {t(($) => $.comment.continuous_confirm_max_hint, {
                  current: displayRound,
                  max: plan.max,
                })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-live-done">{t(($) => $.comment.continuous_confirm_done_marker)}</Label>
              <Input
                id="cc-live-done"
                value={doneMarker}
                onChange={(e) => setDoneMarker(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-live-brief">{t(($) => $.comment.continuous_confirm_brief)}</Label>
              <Textarea
                id="cc-live-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={5}
                className="text-caption resize-y min-h-24"
              />
              <p className="text-caption text-muted-foreground">
                {t(($) => $.comment.continuous_confirm_brief_help)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-live-prompt">{t(($) => $.comment.continuous_confirm_prompt)}</Label>
              <Textarea
                id="cc-live-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="text-caption resize-y min-h-28"
              />
              <p className="text-caption text-muted-foreground">
                {t(($) => $.comment.continuous_confirm_placeholders)}
              </p>
            </div>
            <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
              <Label>{t(($) => $.comment.continuous_confirm_preview)}</Label>
              <pre className="whitespace-pre-wrap break-words text-caption text-muted-foreground max-h-48 overflow-y-auto">
                {renderContinuousConfirmPrompt(
                  prompt,
                  Math.max(displayRound, 1),
                  max,
                  doneMarker,
                  brief,
                )}
              </pre>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.comment.continuous_confirm_preview_help)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => stopMutation.mutate()}
            >
              {stopMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {t(($) => $.comment.continuous_confirm_stop)}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => fireMutation.mutate()}
              >
                {fireMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {t(($) => $.comment.continuous_confirm_fire)}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t(($) => $.comment.continuous_confirm_apply)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
