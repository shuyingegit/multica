"use client";

import { useMemo, useState } from "react";
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
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";
import {
  CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
  CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
  CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
  parseContinuousConfirmPlan,
  renderContinuousConfirmPrompt,
  resolveContinuousConfirmMaxInput,
  sanitizeContinuousConfirmMaxDraft,
  saveContinuousConfirmDraft,
} from "../lib/continuous-confirm";

type Props = {
  issue: Issue;
};

type DialogMode = "preview" | "edit";

/** Live progress + clickable editor for the continuous-confirm plan. */
export function ContinuousConfirmStatus({ issue }: Props) {
  const { t } = useT("issues");
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  const plan = parseContinuousConfirmPlan(issue.metadata);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>("preview");
  // String draft so typing "200" over "100" does not snap back on every digit.
  const [maxDraft, setMaxDraft] = useState("20");
  const [prompt, setPrompt] = useState(CONTINUOUS_CONFIRM_DEFAULT_PROMPT);
  const [doneMarker, setDoneMarker] = useState(CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER);
  const [brief, setBrief] = useState("");
  const { data: tasks } = useQuery(issueTasksOptions(issue.id));

  const hydrateFromPlan = (p: NonNullable<typeof plan>) => {
    setMode("preview");
    setMaxDraft(String(p.max));
    setPrompt(p.prompt);
    setDoneMarker(p.doneMarker);
    setBrief(p.brief);
  };

  const openDialog = () => {
    if (plan) hydrateFromPlan(plan);
    setOpen(true);
  };

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

  const maxFloor = plan ? Math.max(plan.max, plan.rounds || 1) : 1;
  const resolvedMax = resolveContinuousConfirmMaxInput(maxDraft, maxFloor);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateContinuousConfirmPlan(issue.id, {
        max: resolvedMax,
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
  const previewText = renderContinuousConfirmPrompt(
    prompt,
    Math.max(displayRound, 1),
    resolvedMax,
    doneMarker,
    brief,
  );

  const commitMaxDraft = () => {
    setMaxDraft(String(resolveContinuousConfirmMaxInput(maxDraft, maxFloor)));
  };

  return (
    <>
      <button
        type="button"
        className="mb-2 w-full rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-left text-caption hover:bg-muted/70 transition-colors"
        data-testid="continuous-confirm-status"
        onClick={openDialog}
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next && plan) hydrateFromPlan(plan);
          setOpen(next);
        }}
      >
        {/* Override DialogContent's default sm:max-w-sm — that was crushing desktop width. */}
        <DialogContent
          className={cn(
            "flex w-[calc(100%-1rem)] max-h-[90dvh] flex-col gap-3 overflow-hidden p-4 sm:p-5",
            "sm:max-w-2xl md:max-w-3xl",
          )}
        >
          <DialogHeader className="shrink-0 space-y-1">
            <DialogTitle>{t(($) => $.comment.continuous_confirm_settings)}</DialogTitle>
            <p className="text-caption text-muted-foreground font-normal">
              {t(($) => $.comment.continuous_confirm_plan_help)}
            </p>
          </DialogHeader>

          <div className="flex shrink-0 gap-1 rounded-lg bg-muted/50 p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "preview" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => {
                commitMaxDraft();
                setMode("preview");
              }}
            >
              {t(($) => $.comment.continuous_confirm_mode_preview)}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "edit" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setMode("edit")}
            >
              {t(($) => $.comment.continuous_confirm_mode_edit)}
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
            {mode === "preview" ? (
              <div className="space-y-3">
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-caption">
                  <div className="font-medium text-foreground">
                    {t(($) => $.comment.continuous_confirm_progress, {
                      current: displayRound,
                      max: resolvedMax,
                    })}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(($) => $.comment.continuous_confirm_max_hint, {
                      current: displayRound,
                      max: plan.max,
                    })}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {t(($) => $.comment.continuous_confirm_done_hint, { marker: doneMarker })}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
                  <Label>{t(($) => $.comment.continuous_confirm_preview)}</Label>
                  <pre className="max-h-[min(50dvh,28rem)] overflow-y-auto whitespace-pre-wrap break-words text-caption leading-relaxed text-foreground/90">
                    {previewText}
                  </pre>
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.comment.continuous_confirm_preview_help)}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setMode("edit")}>
                  <Pencil className="size-3.5" />
                  {t(($) => $.comment.continuous_confirm_mode_edit)}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cc-live-max">{t(($) => $.comment.continuous_confirm_max)}</Label>
                  <Input
                    id="cc-live-max"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    value={maxDraft}
                    onChange={(e) => setMaxDraft(sanitizeContinuousConfirmMaxDraft(e.target.value))}
                    onBlur={commitMaxDraft}
                  />
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.comment.continuous_confirm_max_hint, {
                      current: displayRound,
                      max: plan.max,
                    })}{" "}
                    {t(($) => $.comment.continuous_confirm_max_range, {
                      floor: maxFloor,
                      absolute: CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
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
                    rows={8}
                    className="min-h-32 resize-y text-caption leading-relaxed"
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
                    className="min-h-28 resize-y text-caption leading-relaxed"
                  />
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.comment.continuous_confirm_placeholders)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border/50 pt-3 sm:flex-row sm:flex-wrap sm:justify-between">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => stopMutation.mutate()}
            >
              {stopMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {t(($) => $.comment.continuous_confirm_stop)}
            </Button>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => fireMutation.mutate()}
              >
                {fireMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {t(($) => $.comment.continuous_confirm_fire)}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => {
                  commitMaxDraft();
                  saveMutation.mutate();
                }}
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
