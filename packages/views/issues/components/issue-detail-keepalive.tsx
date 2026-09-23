"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IssueDetail } from "./issue-detail";

/** Match the sidebar pin preview limit — enough for A↔B↔C without unbounded memory. */
const KEEP_ALIVE_LIMIT = 5;

type KeepAliveEntry = {
  issueId: string;
  onDelete?: () => void;
  highlightCommentId?: string;
  defaultSidebarOpen: boolean;
};

type KeepAliveApi = {
  /**
   * Mark `issueId` as the visible detail and retain it in the MRU cache.
   * Call from `IssueDetailRoute` once the segment has resolved to a UUID.
   */
  activate: (entry: KeepAliveEntry) => void;
  /** Hide all kept trees (e.g. when leaving a detail route for the list). */
  deactivate: () => void;
};

const IssueDetailKeepAliveContext = createContext<KeepAliveApi | null>(null);

export function useIssueDetailKeepAlive(): KeepAliveApi | null {
  return useContext(IssueDetailKeepAliveContext);
}

/**
 * Host that keeps recently opened issue detail trees mounted (hidden) so pin
 * A↔B↔C switches do not remount TipTap / timeline from scratch.
 *
 * Must wrap a Next.js / router boundary that survives `/issues/:id` param
 * changes (e.g. `issues/layout.tsx`). Without this provider,
 * `IssueDetailRoute` falls back to a single mounted detail.
 */
export function IssueDetailKeepAliveHost({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [entries, setEntries] = useState<KeepAliveEntry[]>([]);

  const activate = useCallback((entry: KeepAliveEntry) => {
    setActiveId(entry.issueId);
    setEntries((prev) => {
      const rest = prev.filter((e) => e.issueId !== entry.issueId);
      const next = [entry, ...rest].slice(0, KEEP_ALIVE_LIMIT);
      // Skip update when nothing meaningful changed (avoids render loops from
      // IssueDetailRoute calling activate every render with stable props).
      if (
        next.length === prev.length &&
        next.every((e, i) => {
          const p = prev[i]!;
          return (
            e.issueId === p.issueId &&
            e.onDelete === p.onDelete &&
            e.highlightCommentId === p.highlightCommentId &&
            e.defaultSidebarOpen === p.defaultSidebarOpen
          );
        })
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const deactivate = useCallback(() => {
    setActiveId(null);
  }, []);

  const api = useMemo(() => ({ activate, deactivate }), [activate, deactivate]);

  return (
    <IssueDetailKeepAliveContext.Provider value={api}>
      {children}
      {entries.map((entry) => {
        const active = entry.issueId === activeId;
        return (
          <div
            key={entry.issueId}
            // `hidden` keeps the DOM (and scrollTop) without painting. Inactive
            // trees stay subscribed to TQ/WS so coming back is a CSS show.
            hidden={!active}
            aria-hidden={!active}
            className={active ? "contents" : undefined}
          >
            <IssueDetail
              issueId={entry.issueId}
              onDelete={active ? entry.onDelete : undefined}
              highlightCommentId={active ? entry.highlightCommentId : undefined}
              defaultSidebarOpen={entry.defaultSidebarOpen}
            />
          </div>
        );
      })}
    </IssueDetailKeepAliveContext.Provider>
  );
}
