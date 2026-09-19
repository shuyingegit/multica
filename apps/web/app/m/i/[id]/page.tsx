"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { AppLink } from "@multica/views/navigation";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { RichContent } from "@multica/views/rich-content";
import { formatShareRelativeTime } from "@multica/core/issue-public-share";
import { useMobileWorkspace } from "../../workspace";

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
      return status ?? "";
  }
}

export default function MobileIssuePage() {
  const params = useParams<{ id: string }>();
  const issueKey = params?.id ?? "";
  const { ws, ready } = useMobileWorkspace();
  const wsId = ws?.id ?? "";
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);

  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, issueKey),
    enabled: ready && !!issueKey,
  });
  const issue = issueQuery.data;
  const commentsQuery = useQuery({
    queryKey: ["m-comments", wsId, issue?.id],
    queryFn: () => api.listComments(issue!.id),
    enabled: ready && !!issue?.id,
    refetchInterval: 5000,
  });
  const workQuery = useQuery({
    queryKey: ["m-working", wsId],
    queryFn: () => api.getWorkspaceWorkingAgents("issue"),
    enabled: ready,
    refetchInterval: 5000,
  });
  const agentsQuery = useQuery({
    queryKey: ["m-agents", wsId],
    queryFn: () => api.listAgents({ workspace_id: wsId }),
    enabled: ready,
  });

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const comments = commentsQuery.data ?? [];
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agentsQuery.data]);

  const workers = (workQuery.data ?? [])
    .filter((agent) => issue && agent.issue_ids?.includes(issue.id))
    .map((agent) => agent.name);

  async function send() {
    const text = draft.trim();
    if (!text || sending || !issue) return;
    setSending(true);
    setError(null);
    try {
      await api.createComment(issue.id, text);
      setDraft("");
      await commentsQuery.refetch();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  if (!ready || issueQuery.isPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (!issue) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-4">
        <p className="text-center text-muted-foreground">这张票打不开。</p>
        <AppLink href="/m" className="text-center text-body">
          返回关注的票
        </AppLink>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh max-w-lg flex-col px-3 pb-[env(safe-area-inset-bottom)] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="shrink-0 border-b border-border pb-3">
        <div className="mb-2 flex items-center justify-between">
          <AppLink href="/m" className="min-h-11 text-body text-muted-foreground">
            返回
          </AppLink>
          <span className="text-caption text-muted-foreground">{statusLabel(issue.status)}</span>
        </div>
        <p className="text-caption text-muted-foreground">{issue.identifier}</p>
        <h1 className="text-title font-medium leading-snug">{issue.title}</h1>
        {workers.length > 0 ? (
          <p className="mt-2 rounded-xl bg-brand/15 px-3 py-2 text-body" role="status">
            {workers.join("、")} 正在处理
          </p>
        ) : null}
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-caption text-muted-foreground">还没有消息。</p>
        ) : (
          comments.map((c) => {
            const name =
              c.author_type === "agent"
                ? names.get(c.author_id) || "智能体"
                : c.author_type === "system"
                  ? "系统"
                  : "成员";
            return (
              <div key={c.id} className="rounded-2xl border border-border bg-muted/30 px-3 py-2">
                <p className="mb-1 text-caption text-muted-foreground">
                  <span className="font-medium text-foreground">{name}</span>
                  {" · "}
                  {formatShareRelativeTime(c.created_at, nowMs)}
                  {c.type === "progress_update" ? " · 处理记录" : ""}
                </p>
                <div className="break-words text-body">
                  <RichContent content={c.content} density="compact" />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-border pt-3">
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        <Textarea
          rows={2}
          placeholder="回复这张票"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button className="min-h-11 w-full" disabled={sending || !draft.trim()} onClick={() => void send()}>
          {sending ? "发送中…" : "发送"}
        </Button>
      </div>
    </main>
  );
}
