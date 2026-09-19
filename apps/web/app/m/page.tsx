"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { pinListOptions } from "@multica/core/pins/queries";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { AppLink } from "@multica/views/navigation";
import { formatPinRelativeAge, usePinUnreadStore } from "@multica/core/pins";
import type { Workspace } from "@multica/core/types";

function lastWorkspaceSlug(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )last_workspace_slug=([^;]*)/);
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

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

function pickWorkspace(workspaces: Workspace[], slug: string): Workspace | undefined {
  if (slug) {
    const hit = workspaces.find((w) => w.slug === slug);
    if (hit) return hit;
  }
  return workspaces[0];
}

/**
 * Mobile pin tracker at /m. Same pin data as the desktop rail.
 * Opening a ticket lands on the newest message (#latest); unread pins do too
 * (the newest unread is the latest comment).
 */
export default function MobilePinsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [preferredSlug, setPreferredSlug] = useState("");
  const { data: workspaces = [], isLoading: wsLoading } = useQuery(workspaceListOptions());

  useEffect(() => {
    setPreferredSlug(lastWorkspaceSlug());
  }, []);

  const ws = useMemo(
    () => pickWorkspace(workspaces, preferredSlug),
    [workspaces, preferredSlug],
  );
  const wsId = ws?.id ?? "";
  const slug = ws?.slug ?? "";

  useEffect(() => {
    if (!user && !wsLoading) {
      router.replace("/login?next=/m");
    }
  }, [user, wsLoading, router]);

  const pinsQuery = useQuery({
    ...pinListOptions(wsId, user?.id ?? ""),
    enabled: !!wsId && !!user?.id,
  });
  const pins = pinsQuery.data ?? [];
  const issuePins = pins.filter((p) => p.item_type === "issue");
  const details = useQueries({
    queries: issuePins.map((pin) => ({
      ...issueDetailOptions(wsId, pin.item_id),
      enabled: !!wsId,
    })),
  });

  const rows = issuePins
    .map((pin, i) => {
      const issue = details[i]?.data;
      const activity = issue?.last_activity_at || issue?.updated_at || pin.created_at;
      return { pin, issue, activity };
    })
    .sort((a, b) => Date.parse(b.activity) - Date.parse(a.activity));

  const unreadOf = usePinUnreadStore((s) => s.unreadCounts);

  if (!user || wsLoading || (wsId && pinsQuery.isPending)) {
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
        <p className="mt-1 text-caption text-muted-foreground">
          {ws?.name ?? "工作区"} · 点卡片直接到最新一条
        </p>
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
            const segment = issue?.identifier || issue?.id || pin.item_id;
            const unread = unreadOf[pin.item_id] ?? 0;
            const href = slug ? `/${slug}/issues/${encodeURIComponent(segment)}#latest` : "#";
            const age = formatPinRelativeAge(activity);
            const status = statusLabel(issue?.status);
            return (
              <AppLink
                key={pin.id}
                href={href}
                className="block rounded-2xl border border-border bg-muted/30 px-3 py-4 active:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body text-muted-foreground">{id || "…"}</span>
                  <span className="flex items-center gap-2 text-caption text-muted-foreground">
                    {status ? <span className="rounded-full border border-border px-2 py-0.5">{status}</span> : null}
                    {unread > 0 ? (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-brand-foreground">{unread}</span>
                    ) : null}
                    {age}
                  </span>
                </div>
                <p className="mt-1 text-body font-medium leading-snug">{title}</p>
              </AppLink>
            );
          })
        )}
      </div>
      {slug ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-3 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg gap-2">
            <AppLink
              href={`/${slug}/issues?create=1`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand px-3 text-body text-brand-foreground"
            >
              新建票
            </AppLink>
            <AppLink
              href={`/${slug}`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border px-3 text-body"
            >
              打开工作区
            </AppLink>
          </div>
        </div>
      ) : null}
    </main>
  );
}
