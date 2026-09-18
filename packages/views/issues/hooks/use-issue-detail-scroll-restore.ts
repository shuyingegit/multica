import { useLayoutEffect, useRef } from "react";

type UseIssueDetailScrollRestoreArgs = {
  restoreKey: string;
  scrollContainerEl: HTMLElement | null;
  ready: boolean;
  disabled?: boolean;
  /**
   * Authoritative restore target from the platform's tab memento, when one
   * is being served (MUL-4741). It wins over this hook's module-level map:
   * the memento is captured from the live DOM at the moment the view is
   * left, while the map only hears scroll *events* — content-driven
   * position shifts (scroll anchoring, streaming blocks collapsing) move
   * scrollTop without one, leaving the map holding an older visit. Without
   * this, the two restores race and the retry loop below overwrites the
   * memento's fresher offset with the stale one.
   */
  overrideTop?: number;
};

const scrollPositions = new Map<string, number>();
const SCROLL_POSITION_CACHE_MAX_SIZE = 100;
const SESSION_STORAGE_KEY = "multica_issue_detail_scroll_v1";

function readSessionScrollMap(): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  if (scrollPositions.size > 0) return;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value > 0) {
        scrollPositions.set(key, value);
      }
    }
  } catch {
    // Corrupt / quota — start empty.
  }
}

function writeSessionScrollMap(): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    const obj: Record<string, number> = {};
    for (const [key, value] of scrollPositions) {
      obj[key] = value;
    }
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // QuotaExceeded — ignore; in-memory map still works for the SPA session.
  }
}

// Hydrate once at module load so the first visit after a soft reload can
// restore. Full page reloads intentionally keep sessionStorage (same tab).
readSessionScrollMap();

export function useIssueDetailScrollRestore({
  restoreKey,
  scrollContainerEl,
  ready,
  disabled = false,
  overrideTop,
}: UseIssueDetailScrollRestoreArgs) {
  const restoredKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    restoredKeyRef.current = null;
  }, [restoreKey]);

  useLayoutEffect(() => {
    if (!scrollContainerEl || disabled || !ready) return;

    const save = () => {
      saveScrollPosition(restoreKey, scrollContainerEl.scrollTop);
    };

    scrollContainerEl.addEventListener("scroll", save, { passive: true });

    return () => {
      save();
      scrollContainerEl.removeEventListener("scroll", save);
    };
  }, [scrollContainerEl, restoreKey, ready, disabled]);

  useLayoutEffect(() => {
    if (!scrollContainerEl || !ready) return;
    if (disabled) {
      restoredKeyRef.current = restoreKey;
      return;
    }
    if (restoredKeyRef.current === restoreKey) return;

    restoredKeyRef.current = restoreKey;

    const target = overrideTop ?? scrollPositions.get(restoreKey) ?? 0;
    if (target <= 1) {
      scrollContainerEl.scrollTop = target;
      return;
    }

    return restoreScrollTopWithRetry(scrollContainerEl, target);
  }, [scrollContainerEl, restoreKey, ready, disabled, overrideTop]);
}

function saveScrollPosition(restoreKey: string, scrollTop: number) {
  if (scrollPositions.has(restoreKey)) {
    scrollPositions.delete(restoreKey);
  } else if (scrollPositions.size >= SCROLL_POSITION_CACHE_MAX_SIZE) {
    const oldestKey = scrollPositions.keys().next().value;
    if (oldestKey !== undefined) scrollPositions.delete(oldestKey);
  }

  scrollPositions.set(restoreKey, scrollTop);
  writeSessionScrollMap();
}

function restoreScrollTopWithRetry(el: HTMLElement, target: number) {
  let cancelled = false;
  let attempts = 0;
  let stableFrames = 0;
  // Content (markdown / images / virtuoso) often settles after the first
  // paint; keep retrying long enough that pin A→B→A restores stick.
  const maxAttempts = 60;
  const requiredStableFrames = 2;

  el.scrollTop = target;

  let frameId: number;

  const tick = () => {
    if (cancelled || !el.isConnected) return;

    attempts += 1;

    if (Math.abs(el.scrollTop - target) <= 1) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
      el.scrollTop = target;
    }

    // A virtualized timeline initializes after the parent's layout effect and
    // may reset a synchronous scroll write. Requiring stability across frames
    // keeps the restore alive long enough to outlast that initialization.
    if (stableFrames >= requiredStableFrames || attempts >= maxAttempts) {
      return;
    }

    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frameId);
  };
}
