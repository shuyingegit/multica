"use client";

import { ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";

type ScrollEdgeButtonsProps = {
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  topLabel: string;
  bottomLabel: string;
  /** Icon-only row for toolbars (chat header). */
  variant?: "toolbar" | "stack";
  className?: string;
};

/**
 * Jump-to-edge controls for long scroll surfaces (issue timeline, floating chat).
 * Toolbar = inline header icons; stack = floating pill above the chat launcher.
 */
export function ScrollEdgeButtons({
  onScrollToTop,
  onScrollToBottom,
  topLabel,
  bottomLabel,
  variant = "toolbar",
  className,
}: ScrollEdgeButtonsProps) {
  const stacked = variant === "stack";
  return (
    <div
      className={cn(
        stacked
          ? "flex flex-col gap-0.5 rounded-full bg-surface-raised p-0.5 shadow-[var(--floating-shadow)] ring-1 ring-surface-border"
          : "flex items-center gap-0.5",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={topLabel}
              onClick={onScrollToTop}
            />
          }
        >
          <ChevronsUp />
        </TooltipTrigger>
        <TooltipContent side={stacked ? "left" : "top"}>{topLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={bottomLabel}
              onClick={onScrollToBottom}
            />
          }
        >
          <ChevronsDown />
        </TooltipTrigger>
        <TooltipContent side={stacked ? "left" : "top"}>{bottomLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
