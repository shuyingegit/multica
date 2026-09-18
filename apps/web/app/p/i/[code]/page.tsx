"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@multica/core/api";
import {
  formatShareRelativeTime,
  loadGuestProfile,
  parseGuestComment,
  saveGuestProfile,
  type IssuePublicShareMeta,
  type PublicShareComment,
  type PublicShareGuestProfile,
} from "@multica/core/issue-public-share";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { RichContent } from "@multica/views/rich-content";

type MentionOption = { label: string; kind: "assignee" | "agent" | "member" | "guest" };

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: Record<string, string>;
    };
    const a = data.address ?? {};
    const city = a.city || a.town || a.county || a.state || "";
    const road = a.road || a.neighbourhood || a.suburb || a.village || "";
    const parts = [city, road].filter(Boolean);
    if (parts.length >= 2) return parts.join("·");
    // City-only / country-only is not specific enough.
    return null;
  } catch {
    return null;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
  const [profile, setProfile] = useState<PublicShareGuestProfile | null>(null);
  const [nickDraft, setNickDraft] = useState("");
  const [locStatus, setLocStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!code) return;
    setProfile(loadGuestProfile(code));
  }, [code]);

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

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setLocStatus("fail");
      return;
    }
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const label = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (label) {
          setProfile((prev) => {
            const next = {
              nickname: prev?.nickname || nickDraft.trim() || "访客",
              location: label,
            };
            if (code && next.nickname) saveGuestProfile(code, next);
            return prev ? { ...prev, location: label } : next;
          });
          setLocStatus("ok");
        } else {
          setLocStatus("fail");
        }
      },
      () => setLocStatus("fail"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    );
  }, [code, nickDraft]);

  function confirmNickname() {
    const name = nickDraft.trim();
    if (!name || !code) return;
    const next: PublicShareGuestProfile = {
      nickname: name,
      location: profile?.location,
    };
    saveGuestProfile(code, next);
    setProfile(next);
    void requestLocation();
  }

  async function unlock() {
    setUnlocking(true);
    try {
      const res = await api.unlockPublicIssueShare(code, password);
      setToken(res.token);
      const m = await api.getPublicIssueShareMeta(code);
      setMeta({ ...m, needs_password: false, unlocked: true });
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "密码错误");
    } finally {
      setUnlocking(false);
    }
  }

  const mentionOptions = useMemo(() => {
    const opts: MentionOption[] = [];
    if (meta?.assignee_name) {
      opts.push({
        label: meta.assignee_name,
        kind: meta.assignee_type === "agent" ? "agent" : "assignee",
      });
    }
    const seen = new Set(opts.map((o) => o.label));
    for (const c of comments) {
      const name =
        c.author_name ||
        c.guest_nickname ||
        (c.is_guest ? "访客" : c.author_type === "agent" ? "智能体" : "团队");
      if (!name || seen.has(name)) continue;
      seen.add(name);
      opts.push({
        label: name,
        kind: c.is_guest ? "guest" : c.author_type === "agent" ? "agent" : "member",
      });
    }
    return opts;
  }, [comments, meta]);

  function insertMention(label: string) {
    setDraft((d) => {
      const next = d.replace(/@([^\s@]*)$/, `@${label} `);
      return next.includes(`@${label}`) ? next : `${d}@${label} `;
    });
    setMentionOpen(false);
    taRef.current?.focus();
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items.filter((i) => i.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    const chunks: string[] = [];
    for (const item of images) {
      const file = item.getAsFile();
      if (!file) continue;
      const dataUrl = await fileToDataUrl(file);
      chunks.push(`![image](${dataUrl})`);
    }
    if (chunks.length) {
      setDraft((d) => (d ? `${d}\n${chunks.join("\n")}` : chunks.join("\n")));
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending || !profile?.nickname) return;
    setSending(true);
    try {
      let body = text;
      if (!/@\S+/.test(body) && meta?.assignee_name) {
        body = `@${meta.assignee_name} ${body}`;
      }
      await api.createPublicIssueShareComment(
        code,
        body,
        token,
        profile.nickname,
        profile.location,
      );
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

  if (!profile?.nickname) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-10">
        <div>
          <h1 className="text-title font-medium">{meta.identifier}</h1>
          <p className="mt-1 text-body text-muted-foreground">{meta.title}</p>
        </div>
        <p className="text-caption text-muted-foreground">
          进入前请先设置昵称。之后消息都会以这个名字显示；系统也会尝试获取你所在的城市与道路。
        </p>
        <Input
          placeholder="怎么称呼你？"
          value={nickDraft}
          maxLength={32}
          onChange={(e) => setNickDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmNickname();
          }}
        />
        <Button disabled={nickDraft.trim().length < 1} onClick={() => confirmNickname()}>
          进入聊天
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col bg-background px-3 pb-[env(safe-area-inset-bottom)] pt-4 sm:px-4 sm:py-6">
      <header className="mb-3 shrink-0 border-b border-border pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">{meta.identifier}</p>
            <h1 className="truncate text-title font-medium">{meta.title}</h1>
            <p className="mt-1 text-caption text-muted-foreground">
              你是 {profile.nickname}
              {profile.location
                ? ` · ${profile.location}`
                : locStatus === "loading"
                  ? " · 定位中…"
                  : null}
              {meta.assignee_name ? ` · 默认找 @${meta.assignee_name}` : null}
            </p>
          </div>
          {!profile.location ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void requestLocation()}>
              {locStatus === "loading" ? "定位中" : "获取位置"}
            </Button>
          ) : null}
        </div>
        {mentionOptions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mentionOptions.slice(0, 8).map((m) => (
              <span
                key={`${m.kind}-${m.label}`}
                className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-caption text-muted-foreground"
              >
                {m.label}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-caption text-muted-foreground">
            还没有消息。输入问题开始对话（可粘贴图片，输入 @ 点名）。
          </p>
        ) : (
          comments.map((c) => {
            const parsed = parseGuestComment(c.content);
            const guest = parsed.isGuest || !!c.is_guest;
            const body = parsed.body;
            const name =
              c.author_name ||
              parsed.nickname ||
              c.guest_nickname ||
              (guest ? "访客" : c.author_type === "agent" ? "智能体" : "团队");
            const loc = parsed.location || c.guest_location;
            const mine = guest && parsed.nickname === profile.nickname;
            return (
              <div
                key={c.id}
                className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium"
                  aria-hidden
                >
                  {name.slice(0, 1)}
                </div>
                <div
                  className={`min-w-0 max-w-[85%] rounded-2xl border px-3 py-2 text-body ${
                    mine
                      ? "border-brand/30 bg-brand/5"
                      : guest
                        ? "border-border bg-muted/30"
                        : "border-border bg-muted/50"
                  }`}
                >
                  <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground">
                    <span className="font-medium text-foreground">{name}</span>
                    {loc ? <span>{loc}</span> : null}
                    <span>{formatShareRelativeTime(c.created_at, nowMs)}</span>
                  </p>
                  <div className="break-words">
                    <RichContent content={body} density="compact" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 shrink-0 space-y-2 border-t border-border pt-3">
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        {mentionOpen && mentionOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2">
            {mentionOptions.map((m) => (
              <Button
                key={`pick-${m.kind}-${m.label}`}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => insertMention(m.label)}
              >
                @{m.label}
              </Button>
            ))}
          </div>
        ) : null}
        <Textarea
          ref={taRef}
          rows={3}
          placeholder="输入消息，可粘贴图片；输入 @ 点名…"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            setMentionOpen(/@\S*$/.test(v) || v.endsWith("@"));
          }}
          onPaste={(e) => void onPaste(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption text-muted-foreground">Ctrl/⌘ + Enter 发送</p>
          <Button disabled={sending || !draft.trim()} onClick={() => void send()}>
            发送
          </Button>
        </div>
      </div>
    </main>
  );
}
