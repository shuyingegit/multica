"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { useT } from "../../i18n";
import {
  CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
  CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
  CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
  loadContinuousConfirmDraft,
  resolveContinuousConfirmMaxInput,
  sanitizeContinuousConfirmMaxDraft,
  saveContinuousConfirmDraft,
  type ContinuousConfirmDraft,
} from "../lib/continuous-confirm";

export type ContinuousConfirmControlsProps = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  draft: ContinuousConfirmDraft;
  onDraftChange: (draft: ContinuousConfirmDraft) => void;
};

/** Checkbox + settings popover for the continuous-confirm outer-loop plan. */
export function ContinuousConfirmControls({
  enabled,
  onEnabledChange,
  draft,
  onDraftChange,
}: ContinuousConfirmControlsProps) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(draft);
  const [maxDraft, setMaxDraft] = useState(String(draft.max));

  useEffect(() => {
    if (!open) return;
    setLocal(draft);
    setMaxDraft(String(draft.max));
  }, [open, draft]);

  const apply = () => {
    const next: ContinuousConfirmDraft = {
      max: resolveContinuousConfirmMaxInput(maxDraft, 1),
      prompt: local.prompt.trim() || CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker: local.doneMarker.trim() || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    };
    onDraftChange(next);
    saveContinuousConfirmDraft(next);
    setOpen(false);
  };

  const resetDefaults = () => {
    setLocal({
      max: 20,
      prompt: CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker: CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    });
    setMaxDraft("20");
  };

  return (
    <div className="flex items-center gap-0.5">
      <label
        className="flex items-center gap-1 pr-0.5 text-caption text-muted-foreground cursor-pointer select-none"
        title={t(($) => $.comment.continuous_confirm_hint)}
      >
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => onEnabledChange(v === true)}
          aria-label={t(($) => $.comment.continuous_confirm)}
        />
        <span className="whitespace-nowrap">{t(($) => $.comment.continuous_confirm)}</span>
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-6 text-muted-foreground"
              aria-label={t(($) => $.comment.continuous_confirm_settings)}
              title={t(($) => $.comment.continuous_confirm_settings)}
            />
          }
        >
          <Settings2 className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(28rem,calc(100vw-1.5rem))] space-y-3 p-3">
          <PopoverTitle className="text-sm font-medium">
            {t(($) => $.comment.continuous_confirm_settings)}
          </PopoverTitle>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.comment.continuous_confirm_plan_help)}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cc-max" className="text-caption">
              {t(($) => $.comment.continuous_confirm_max)}
            </Label>
            <Input
              id="cc-max"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={maxDraft}
              onChange={(e) => setMaxDraft(sanitizeContinuousConfirmMaxDraft(e.target.value))}
              onBlur={() => setMaxDraft(String(resolveContinuousConfirmMaxInput(maxDraft, 1)))}
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.comment.continuous_confirm_max_range, {
                floor: 1,
                absolute: CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
              })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-done" className="text-caption">
              {t(($) => $.comment.continuous_confirm_done_marker)}
            </Label>
            <Input
              id="cc-done"
              value={local.doneMarker}
              onChange={(e) => setLocal((d) => ({ ...d, doneMarker: e.target.value }))}
              placeholder={CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-prompt" className="text-caption">
              {t(($) => $.comment.continuous_confirm_prompt)}
            </Label>
            <Textarea
              id="cc-prompt"
              value={local.prompt}
              onChange={(e) => setLocal((d) => ({ ...d, prompt: e.target.value }))}
              rows={5}
              className="text-caption resize-y min-h-24"
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.comment.continuous_confirm_placeholders)}
            </p>
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" onClick={resetDefaults}>
              {t(($) => $.comment.continuous_confirm_reset)}
            </Button>
            <Button type="button" size="sm" onClick={apply}>
              {t(($) => $.comment.continuous_confirm_apply)}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Hook-friendly initial draft from localStorage. */
export function useContinuousConfirmDraftState() {
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState<ContinuousConfirmDraft>(() => loadContinuousConfirmDraft());
  return { enabled, setEnabled, draft, setDraft };
}
