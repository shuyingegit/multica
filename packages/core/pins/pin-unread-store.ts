"use client";

import { create } from "zustand";

/**
 * Pin-rail "new reply" badges — NOT inbox unread.
 *
 * Product rule for the forked Multica sidebar:
 *   1. When the app opens (or a pin first appears), every pin is treated as
 *      already read — no leftover inbox counts.
 *   2. An incoming comment (typically the agent finishing a run) bumps a
 *      per-issue counter even if that issue is currently open — the user
 *      may be looking at the top of the page and miss the new reply.
 *   3. The badge clears only on intentional ack: navigating to / clicking
 *      the pin, or scrolling / interacting with the issue detail surface.
 *
 * Session-scoped only (module zustand, no persist): a full reload reseeds
 * everything as read, matching "系统打开时全部都是已读".
 */
interface PinUnreadState {
  /** Issues that already received a read baseline this tab session. */
  seeded: Record<string, true>;
  unreadCounts: Record<string, number>;
  /** The issue the user is currently viewing (UUID), if any. */
  viewingIssueId: string | null;
  seedIfNeeded: (issueIds: readonly string[]) => void;
  /**
   * Track which issue route is open. Entering a *different* issue marks it
   * read (the navigation itself is the ack). Re-syncing the same id must
   * NOT clear — otherwise a WS-driven cache refresh would wipe a badge that
   * arrived while the page was already open.
   */
  setViewingIssue: (issueId: string | null) => void;
  markRead: (issueId: string) => void;
  /**
   * Record an incoming comment on a pinned issue. Own comments do not bump.
   * Comments on the currently open issue DO bump — clear via markRead.
   */
  noteIncomingComment: (
    issueId: string,
    opts?: { fromSelf?: boolean },
  ) => void;
  /** Test helper — wipe session state. */
  reset: () => void;
}

const EMPTY_SEEDED: Record<string, true> = {};
const EMPTY_COUNTS: Record<string, number> = {};

export const usePinUnreadStore = create<PinUnreadState>((set, get) => ({
  seeded: EMPTY_SEEDED,
  unreadCounts: EMPTY_COUNTS,
  viewingIssueId: null,

  seedIfNeeded: (issueIds) => {
    if (issueIds.length === 0) return;
    const { seeded } = get();
    let changed = false;
    const next = { ...seeded };
    for (const id of issueIds) {
      if (!id || next[id]) continue;
      next[id] = true;
      changed = true;
    }
    if (changed) set({ seeded: next });
  },

  setViewingIssue: (issueId) => {
    const prev = get().viewingIssueId;
    if (prev === issueId) return;
    set({ viewingIssueId: issueId });
    // Navigating onto a pin counts as "clicked to look" — clear its badge.
    if (issueId) get().markRead(issueId);
  },

  markRead: (issueId) => {
    if (!issueId) return;
    set((state) => {
      const nextSeeded = state.seeded[issueId]
        ? state.seeded
        : { ...state.seeded, [issueId]: true as const };
      if (!state.unreadCounts[issueId]) {
        return nextSeeded === state.seeded ? state : { seeded: nextSeeded };
      }
      const { [issueId]: _, ...rest } = state.unreadCounts;
      return { seeded: nextSeeded, unreadCounts: rest };
    });
  },

  noteIncomingComment: (issueId, opts) => {
    if (!issueId || opts?.fromSelf) return;
    const { seeded } = get();
    // Only badge issues we've established a baseline for (i.e. pinned and
    // seen this session). Unseeded ids stay quiet until seedIfNeeded runs.
    if (!seeded[issueId]) return;
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [issueId]: (state.unreadCounts[issueId] ?? 0) + 1,
      },
    }));
  },

  reset: () =>
    set({
      seeded: EMPTY_SEEDED,
      unreadCounts: EMPTY_COUNTS,
      viewingIssueId: null,
    }),
}));

export function selectPinUnreadCount(issueId: string) {
  return (state: PinUnreadState) => state.unreadCounts[issueId] ?? 0;
}
