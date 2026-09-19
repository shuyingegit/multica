"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { pinListOptions } from "@multica/core/pins/queries";
import { issueDetailOptions, issueKeys } from "@multica/core/issues/queries";
import { api } from "@multica/core/api";
import { useWSEvent } from "@multica/core/realtime";
import { AppLink } from "@multica/views/navigation";
import { formatPinRelativeAge } from "@multica/core/pins";
import { useMobileWorkspace } from "./workspace";

const SEEN_KEY = "scs268-pin-seen-at";

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "todo":
      return "待办";
    case "in_progress":
      return "进行中";
    case "in_review":
      return "待验收";
    case "done":
      return "完成";
    case "blocked":
      return "卡住";
    case "backlog":
      return "待排";
    case "cancelled":
      return "取消";
    default:
      return "";
  }
}

function loadSeen(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeen(next: Record<string, string>) {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
}

export default function MobilePinsPage() {
  const { user, ws, ready } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const wsId = ws?.id ?? "";
  const slug = ws?.slug ?? "";
  const [seen, setSeen] = useState<Record<string, string>>({});

  useEffect(() => {
    setSeen(loadSeen());
  }, []);

  const pinsQuery = useQuery({
    ...pinListOptions(wsId, user?.id ?? ""),
    enabled: ready,
  });
  const workQuery = useQuery({
    queryKey: ["m-working", wsId],
    queryFn: () => api.getWorkspaceWorkingAgents("issue"),
    enabled: ready,
    refetchInterval: 8000,
  });

  const pins = pinsQuery.data ?? [];
  const issuePins = pins.filter((p) => p.item_type === "issue");
  const details = useQueries({
    queries: issuePins.map((pin) => ({
      ...issueDetailOptions(wsId, pin.item_id),
      enabled: ready,
    })),
  });

  const commentQueries = useQueries({
    queries: issuePins.map((pin) => ({
      queryKey: ["m-pin-comments", pin.item_id],
      queryFn: () => api.listComments(pin.item_id),
      enabled: ready,
    })),
  });

  const onComment = useCallback(
    (payload: unknown) => {
      const comment = (payload as { comment?: { issue_id?: string } } | null)?.comment;
      if (!comment?.issue_id || !wsId) return;
      void queryClient.invalidateQueries({
        queryKey: issueKeys.detail(wsId, comment.issue_id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["m-pin-comments", comment.issue_id],
      });
    },
    [queryClient, wsId],
  );
  useWSEvent("comment:created", onComment);

  const workingByIssue = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of workQuery.data ?? []) {
      for (const issueId of agent.issue_ids ?? []) {
        const names = map.get(issueId) ?? [];
        names.push(agent.name);
        map.set(issueId, names);
      }
    }
    return map;
  }, [workQuery.data]);

  const rows = issuePins
    .map((pin, i) => {
      const issue = details[i]?.data;
      const activity = issue?.last_activity_at || issue?.updated_at || pin.created_at;
      return { pin, issue, activity };
    })
    .sort((a, b) => {
      const actA = Date.parse(a.activity) || 0;
      const actB = Date.parse(b.activity) || 0;
      if (actA !== actB) return actB - actA;
      return (a.pin.position ?? 0) - (b.pin.position ?? 0);
    });

  function markSeen(issueId: string, at: string) {
    const next = { ...loadSeen(), [issueId]: at };
    saveSeen(next);
    setSeen(next);
  }

  if (!ready || pinsQuery.isPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-3 pb-28 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-3 border-b border-border pb-3">
        <h1 className="text-title font-medium">关注的票</h1>
        <p className="mt-1 text-caption text-muted-foreground">{ws?.name ?? "工作区"}</p>
      </header>
      <div className="flex flex-1 flex-col gap-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">
            还没有固定的票。在电脑上左侧固定栏添加后，这里会同步出现。
          </p>
        ) : (
          rows.map(({ pin, issue, activity }) => {
            const title = issue?.title || "加载标题…";
            const id = issue?.identifier || "";
            const issueId = issue?.id || pin.item_id;
            const openId = issue?.identifier || issueId;
            const href = slug
              ? `/${slug}/issues/${encodeURIComponent(openId)}#latest`
              : `/m/i/${encodeURIComponent(openId)}`;
            const age = formatPinRelativeAge(activity);
            const status = statusLabel(issue?.status);
            const workers = workingByIssue.get(pin.item_id) ?? workingByIssue.get(issue?.id ?? "") ?? [];
            const pinIndex = issuePins.findIndex((p) => p.id === pin.id);
            const comments = pinIndex >= 0 ? commentQueries[pinIndex]?.data : undefined;
            const messages = (comments ?? []).filter((c) => c.type === "comment");
            const prev = seen[issueId];
            const prevMs = prev ? Date.parse(prev) : NaN;
            const unread = !prev
              ? messages.length
              : messages.filter((c) => (Date.parse(c.created_at) || 0) > prevMs).length;
            const latestMs = messages.reduce((max, c) => Math.max(max, Date.parse(c.created_at) || 0), 0);
            return (
              <AppLink
                key={pin.id}
                href={href}
                onClick={() =>
                  markSeen(issueId, latestMs ? new Date(latestMs).toISOString() : new Date().toISOString())
                }
                className="block rounded-2xl border border-border bg-muted/30 px-3 py-4 active:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body text-muted-foreground">{id || "…"}</span>
                  <span className="flex items-center gap-2">
                    {unread > 0 ? (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-caption text-brand-foreground">
                        {unread} 条未读
                      </span>
                    ) : null}
                    <span className="text-caption text-muted-foreground">{age}</span>
                  </span>
                </div>
                <p className="mt-1 text-body font-medium leading-snug">{title}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {workers.length > 0 ? (
                    <span className="rounded-full bg-brand/15 px-2 py-0.5 text-caption text-foreground">
                      {workers.join("、")} 正在处理
                    </span>
                  ) : null}
                  {status ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground">
                      {status}
                    </span>
                  ) : null}
                </div>
              </AppLink>
            );
          })
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          {slug ? (
            <AppLink
              href={`/${slug}/issues?create=1`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand px-3 text-body text-brand-foreground"
            >
              新建票
            </AppLink>
          ) : null}
          {slug ? (
            <AppLink
              href={`/${slug}/issues`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border px-3 text-body"
            >
              电脑版
            </AppLink>
          ) : null}
        </div>
      </div>
    </main>
  );
}
