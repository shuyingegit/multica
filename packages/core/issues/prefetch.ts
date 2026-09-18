import type { QueryClient } from "@tanstack/react-query";
import type { Issue } from "../types";
import {
  issueDetailOptions,
  issueKeys,
  issueTimelineOptions,
} from "./queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIssueUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Find a cached issue detail that matches a human identifier (e.g. `MUL-123`),
 * scanning UUID-keyed entries in the workspace. Used to skip the identifier
 * resolve skeleton when the user already opened the issue earlier in the tab.
 */
export function findCachedIssueByIdentifier(
  qc: QueryClient,
  wsId: string,
  identifier: string,
): Issue | undefined {
  if (!wsId || !identifier) return undefined;
  const direct = qc.getQueryData<Issue>(issueKeys.detail(wsId, identifier));
  if (direct) return direct;

  const needle = identifier.toLowerCase();
  const entries = qc.getQueriesData<Issue>({
    queryKey: [...issueKeys.all(wsId), "detail"],
  });
  for (const [, issue] of entries) {
    if (!issue?.identifier) continue;
    if (issue.identifier === identifier) return issue;
    if (issue.identifier.toLowerCase() === needle) return issue;
  }
  return undefined;
}

/**
 * Mirror a loaded issue into both UUID and identifier detail keys so the next
 * navigation (list UUID link → bar rewrite to identifier, or pin click) hits
 * cache immediately.
 */
export function mirrorIssueDetailCache(
  qc: QueryClient,
  wsId: string,
  issue: Issue,
): void {
  if (!wsId || !issue?.id) return;
  qc.setQueryData<Issue>(issueKeys.detail(wsId, issue.id), (old) => old ?? issue);
  if (issue.identifier && issue.identifier !== issue.id) {
    qc.setQueryData<Issue>(
      issueKeys.detail(wsId, issue.identifier),
      (old) => old ?? issue,
    );
  }
}

/**
 * Warm detail + timeline for an issue URL segment (UUID or identifier).
 * Safe to call from hover/focus prefetch — TanStack dedupes in-flight queries.
 */
export function prefetchIssueNavigation(
  qc: QueryClient,
  wsId: string,
  segment: string,
): void {
  if (!wsId || !segment) return;
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  if (isIssueUuid(decoded)) {
    void qc.prefetchQuery(issueDetailOptions(wsId, decoded));
    void qc.prefetchQuery(issueTimelineOptions(decoded));
    return;
  }

  const cached = findCachedIssueByIdentifier(qc, wsId, decoded);
  if (cached) {
    mirrorIssueDetailCache(qc, wsId, cached);
    void qc.prefetchQuery(issueTimelineOptions(cached.id));
    // Still poke the identifier key so resolve observers settle without network
    // when Infinity-stale data is already present.
    void qc.prefetchQuery(issueDetailOptions(wsId, decoded));
    return;
  }

  void qc.prefetchQuery(issueDetailOptions(wsId, decoded)).then(() => {
    const issue = qc.getQueryData<Issue>(issueKeys.detail(wsId, decoded));
    if (!issue) return;
    mirrorIssueDetailCache(qc, wsId, issue);
    void qc.prefetchQuery(issueTimelineOptions(issue.id));
  });
}

/** Extract `/…/issues/<segment>` from an in-app path (ignores query/hash). */
export function issueSegmentFromPath(path: string): string | null {
  const match = /\/issues\/([^/?#]+)/.exec(path);
  return match?.[1] ?? null;
}
