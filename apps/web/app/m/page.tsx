"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { pinListOptions } from "@multica/core/pins/queries";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { useQueries } from "@tanstack/react-query";
import { AppLink } from "@multica/views/navigation";
import { formatPinRelativeAge } from "@multica/core/pins";

/**
 * Mobile-first pin tracker: open /m on a phone → focus list of pinned issues.
 * Reuses the same pin data as the desktop sidebar (no separate mobile app).
 */
export default function MobilePinsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: workspaces = [], isLoading: wsLoading } = useQuery(workspaceListOptions());
  const ws = workspaces[0];
  const wsId = ws?.id ?? "";
  const slug = ws?.slug ?? "";

  useEffect(() => {
    if (!user && !wsLoading) {
      router.replace("/login?next=/m");
    }
  }, [user, wsLoading, router]);

  const { data: pins = [] } = useQuery({
    ...pinListOptions(wsId, user?.id ?? ""),
    enabled: !!wsId && !!user?.id,
  });
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

  if (!user || wsLoading) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-[env(safe-area-inset-bottom)] pt-4">
      <header className="mb-4 border-b border-border pb-3">
        <h1 className="text-title font-medium">关注的票</h1>
        <p className="mt-1 text-caption text-muted-foreground">
          {ws?.name ?? "工作区"} · 手机轻量视图（与桌面固定栏同源）
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-caption text-muted-foreground">
            还没有固定的票。在桌面端左侧固定栏添加后，这里会同步出现。
          </p>
        ) : (
          rows.map(({ pin, issue, activity }) => {
            const title = issue?.title || pin.item_id.slice(0, 8);
            const id = issue?.identifier || "";
            const href = slug ? `/${slug}/issues/${issue?.id || pin.item_id}` : "#";
            const age = formatPinRelativeAge(activity);
            return (
              <AppLink
                key={pin.id}
                href={href}
                className="rounded-xl border border-border bg-muted/30 px-3 py-3 active:bg-muted/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption text-muted-foreground">{id}</span>
                  {age ? <span className="text-caption text-muted-foreground">{age}</span> : null}
                </div>
                <p className="mt-0.5 text-body font-medium">{title}</p>
              </AppLink>
            );
          })
        )}
      </div>
      {slug ? (
        <div className="mt-4 flex gap-2 border-t border-border pt-3">
          <AppLink
            href={`/${slug}/issues/new`}
            className="flex-1 rounded-lg bg-brand px-3 py-2.5 text-center text-body text-brand-foreground"
          >
            新建票
          </AppLink>
          <AppLink
            href={`/${slug}`}
            className="flex-1 rounded-lg border border-border px-3 py-2.5 text-center text-body"
          >
            打开完整工作区
          </AppLink>
        </div>
      ) : null}
    </main>
  );
}
