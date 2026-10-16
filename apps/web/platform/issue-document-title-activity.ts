"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspace } from "@multica/core/paths";
import type { TabSubject } from "@multica/core/paths";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { agentTaskSnapshotOptions } from "@multica/core/agents";
import { describePinRelativeAge } from "@multica/core/pins";
import type { AgentTask } from "@multica/core/types";

/** Braille spinner frames — browsers cannot animate favicons, so the tab title cycles these. */
export const DOCUMENT_TITLE_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export type IssueDocumentTitleActivity = {
  running: boolean;
  ageLabel: string | null;
};

function issueHasLiveTasks(snapshot: readonly AgentTask[], issueId: string): boolean {
  for (const task of snapshot) {
    if (task.issue_id !== issueId) continue;
    if (task.status === "running") return true;
    // queued / deferred / dispatched — same “still cooking” cue as the pin list
    if (
      task.status === "queued" ||
      task.status === "dispatched" ||
      task.status === "deferred" ||
      task.status === "waiting_local_directory"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Live “running + relative age” for an issue tab — mirrors the pinned-issue
 * trailing cues in the left sidebar so many open tabs stay distinguishable.
 */
export function useIssueDocumentTitleActivity(
  subject: TabSubject,
): IssueDocumentTitleActivity | null {
  const ws = useCurrentWorkspace();
  const wsId = ws?.id ?? "";
  const issueId = subject.kind === "issue" ? subject.id : "";
  const enabled = !!wsId && !!issueId;

  const { data: issue } = useQuery({
    ...issueDetailOptions(wsId, issueId || "__none__"),
    enabled,
  });

  const { data: snapshot = [] } = useQuery({
    ...agentTaskSnapshotOptions(wsId),
    enabled,
  });

  const running = useMemo(
    () => (issueId ? issueHasLiveTasks(snapshot, issueId) : false),
    [snapshot, issueId],
  );

  const nowMs = useDocumentTitleAgeTick(enabled ? 30_000 : 0);
  const age = describePinRelativeAge(
    issue?.last_activity_at ?? issue?.updated_at,
    nowMs,
  );

  if (!enabled) return null;
  return { running, ageLabel: age?.label ?? null };
}

/** Tick so relative ages in the tab title refresh like the pin list. */
function useDocumentTitleAgeTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Compose `⠋ Issue title · 3m` — spinner leads (like the sidebar), age trails
 * (closest we can get to “right-aligned” inside a browser tab string).
 */
export function formatIssueDocumentTitle(
  baseTitle: string,
  activity: IssueDocumentTitleActivity | null,
  spinFrame = 0,
): string {
  if (!activity) return baseTitle;
  const parts: string[] = [];
  if (activity.running) {
    parts.push(
      DOCUMENT_TITLE_SPINNER_FRAMES[
        Math.abs(spinFrame) % DOCUMENT_TITLE_SPINNER_FRAMES.length
      ],
    );
  }
  parts.push(baseTitle);
  if (activity.ageLabel) {
    parts.push(`· ${activity.ageLabel}`);
  }
  return parts.join(" ");
}
