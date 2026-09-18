"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@multica/core/api";
import {
  stripGuestPrefix,
  type IssuePublicShareMeta,
  type PublicShareComment,
} from "@multica/core/issue-public-share";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";

export default function PublicIssueSharePage() {
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";

  const [meta, setMeta] = useState<IssuePublicShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | undefined>();
  const [comments, setComments] = useState<PublicShareComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const loadMeta = useCallback(async () => {
    if (!code) return;
    try {
      const m = await api.getPublicIssueShareMeta(code);
      setMeta(m);
      setError(null);
    } catch {
      setError("链接无效或已关闭");
      setMeta(null);
    }
  }, [code]);

  const loadTimeline = useCallback(async () => {
    if (!code || !meta || meta.needs_password) return;
    try {
      const data = await api.listPublicIssueShareTimeline(code, token);
      setComments(data.comments ?? []);
    } catch {
      // keep prior
    }
  }, [code, meta, token]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadTimeline();
    if (!meta || meta.needs_password) return;
    const id = window.setInterval(() => void loadTimeline(), 4000);
    return () => window.clearInterval(id);
  }, [loadTimeline, meta]);

  async function unlock() {
    setUnlocking(true);
    try {
      const res = await api.unlockPublicIssueShare(code, password);
      setToken(res.token);
      const m = await api.getPublicIssueShareMeta(code);
      // cookie may unlock meta on same origin; force unlocked if token returned
      setMeta({ ...m, needs_password: false, unlocked: true });
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "密码错误");
    } finally {
      setUnlocking(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.createPublicIssueShareComment(code, text, token);
      setDraft("");
      await loadTimeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  if (error && !meta) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-center text-muted-foreground">{error}</p>
      </main>
    );
  }

  if (!meta) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-center text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (meta.needs_password) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-10">
        <div>
          <h1 className="text-title font-medium">{meta.identifier}</h1>
          <p className="mt-1 text-body text-muted-foreground">{meta.title}</p>
        </div>
        <p className="text-caption text-muted-foreground">此对话需要密码才能查看与提问。</p>
        <Input
          type="password"
          placeholder="访问密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void unlock();
          }}
        />
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        <Button disabled={unlocking || password.length < 1} onClick={() => void unlock()}>
          进入对话
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col px-4 py-6">
      <header className="mb-4 shrink-0 border-b border-border pb-3">
        <p className="text-caption text-muted-foreground">{meta.identifier}</p>
        <h1 className="text-title font-medium">{meta.title}</h1>
        <p className="mt-1 text-caption text-muted-foreground">
          仅显示本链接开启之后的对话
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-caption text-muted-foreground">
            还没有消息。输入问题开始对话。
          </p>
        ) : (
          comments.map((c) => {
            const guest = !!c.is_guest || c.content.startsWith("【外部访客】");
            const body = stripGuestPrefix(c.content);
            return (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2 text-body ${
                  guest
                    ? "ml-6 border-brand/30 bg-brand/5"
                    : "mr-6 border-border bg-muted/40"
                }`}
              >
                <p className="mb-1 text-caption text-muted-foreground">
                  {guest ? "访客" : c.author_type === "agent" ? "智能体" : "团队"}
                  {" · "}
                  {new Date(c.created_at).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap break-words">{body}</p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 shrink-0 space-y-2 border-t border-border pt-3">
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        <Textarea
          rows={3}
          placeholder="输入问题…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex justify-end">
          <Button disabled={sending || !draft.trim()} onClick={() => void send()}>
            发送
          </Button>
        </div>
      </div>
    </main>
  );
}
