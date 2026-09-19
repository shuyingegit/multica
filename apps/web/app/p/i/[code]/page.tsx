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
  type PublicShareWork,
} from "@multica/core/issue-public-share";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { RichContent } from "@multica/views/rich-content";

type MentionOption = {
  label: string;
  kind: "agent" | "member" | "guest";
  id?: string;
};

function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function ShareAvatar({ name, url }: { name: string; url?: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = (name.trim().slice(0, 1) || "?").toUpperCase();
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        className="mt-0.5 size-8 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  const hue = avatarHue(name || "访客");
  return (
    <span
      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-medium text-white"
      style={{ background: `hsl(${hue} 55% 42%)` }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

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

type LocGate = "idle" | "asking" | "denied" | "unsupported" | "failed";

function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "北纬" : "南纬";
  const ew = lon >= 0 ? "东经" : "西经";
  return `${ns}${Math.abs(lat).toFixed(3)} ${ew}${Math.abs(lon).toFixed(3)}`;
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
  const [work, setWork] = useState<PublicShareWork[]>([]);
  const [locGate, setLocGate] = useState<LocGate>("idle");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [profile, setProfile] = useState<PublicShareGuestProfile | null>(null);
  const [nickDraft, setNickDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mentionLinks = useRef<{ visible: string; markdown: string }[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!code) return;
    const saved = loadGuestProfile(code);
    setProfile(saved);
    if (saved?.nickname) setNickDraft(saved.nickname);
  }, [code]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let perm: PermissionStatus | null = null;
    const apply = () => {
      if (perm?.state === "denied") setLocGate("denied");
    };
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        perm = status;
        apply();
        status.onchange = apply;
      })
      .catch(() => {
        // Older browsers omit this query; the button still asks.
      });
    return () => {
      if (perm) perm.onchange = null;
    };
  }, []);

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
      setWork(data.work ?? []);
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

  function enterWithLocation() {
    const name = nickDraft.trim();
    if (!name || !code || locGate === "asking") return;
    if (!navigator.geolocation) {
      setLocGate("unsupported");
      return;
    }
    setLocGate("asking");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const label =
          (await reverseGeocode(pos.coords.latitude, pos.coords.longitude)) ||
          formatCoords(pos.coords.latitude, pos.coords.longitude);
        const next: PublicShareGuestProfile = { nickname: name, location: label };
        saveGuestProfile(code, next);
        setProfile(next);
        setLocGate("idle");
      },
      (err) => {
        setLocGate(err.code === err.PERMISSION_DENIED ? "denied" : "failed");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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
    if (meta?.assignee_name && meta.assignee_id && (meta.assignee_type === "agent" || meta.assignee_type === "member")) {
      opts.push({
        label: meta.assignee_name,
        kind: meta.assignee_type,
        id: meta.assignee_id,
      });
    }
    const seen = new Set(opts.map((o) => o.id || o.label));
    for (const c of comments) {
      const guest = !!c.is_guest;
      const name =
        c.author_name ||
        c.guest_nickname ||
        (guest ? "访客" : c.author_type === "agent" ? "智能体" : "团队");
      const kind: MentionOption["kind"] = guest
        ? "guest"
        : c.author_type === "agent"
          ? "agent"
          : "member";
      const id = guest ? undefined : c.author_id;
      const key = id || name;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      opts.push({ label: name, kind, id });
    }
    return opts;
  }, [comments, meta]);

  function mentionMarkdown(m: MentionOption): string {
    if (m.id && (m.kind === "agent" || m.kind === "member")) {
      return `[@${m.label}](mention://${m.kind}/${m.id})`;
    }
    return `@${m.label}`;
  }

  function appendMention(current: string, token: string): string {
    const next = current.replace(/@([^\s@]*)$/, `${token} `);
    return next.includes(token) ? next : `${current}${token} `;
  }

  function expandMentions(text: string): string {
    const items = [...mentionLinks.current].sort((a, b) => b.visible.length - a.visible.length);
    let out = text;
    for (const item of items) {
      if (!item.visible || item.visible === item.markdown) continue;
      out = out.split(item.visible).join(item.markdown);
    }
    return out;
  }

  function insertMention(m: MentionOption, target: string) {
    const markdown = mentionMarkdown(m);
    const visible = `@${m.label}`;
    if (markdown !== visible) {
      mentionLinks.current = [...mentionLinks.current, { visible, markdown }];
    }
    if (target === "bottom") {
      setDraft((d) => appendMention(d, visible));
      taRef.current?.focus();
      return;
    }
    setReplyDrafts((prev) => ({
      ...prev,
      [target]: appendMention(prev[target] ?? "", visible),
    }));
  }

  function mentionKindLabel(kind: MentionOption["kind"]): string {
    if (kind === "agent") return "智能体";
    if (kind === "member") return "成员";
    return "访客";
  }

  function MentionChips({ target }: { target: string }) {
    if (mentionOptions.length === 0) return null;
    return (
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {mentionOptions.map((m) => (
          <button
            key={`${target}-${m.kind}-${m.id || m.label}`}
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 text-body active:bg-muted"
            onClick={() => insertMention(m, target)}
          >
            <span>@{m.label}</span>
            <span className="text-caption text-muted-foreground">{mentionKindLabel(m.kind)}</span>
          </button>
        ))}
      </div>
    );
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

  async function send(parentId?: string) {
    const text = expandMentions((parentId ? replyDrafts[parentId] ?? "" : draft).trim());
    if (!text || sending || !profile?.nickname || !profile.location) return;
    setSending(true);
    try {
      await api.createPublicIssueShareComment(
        code,
        text,
        token,
        profile.nickname,
        profile.location,
        parentId,
      );
      if (parentId) {
        setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
      } else {
        setDraft("");
      }
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

  if (!profile?.nickname || !profile.location) {
    const denied = locGate === "denied";
    const unsupported = locGate === "unsupported";
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-10">
        <div>
          <h1 className="text-title font-medium">{meta.identifier}</h1>
          <p className="mt-1 text-body text-muted-foreground">{meta.title}</p>
        </div>
        <div className="space-y-2 text-body text-muted-foreground">
          <p>进入前必须填写真实姓名，并允许本页获取位置。姓名和位置会记在你发出的每条消息上。</p>
          <p>不同意定位就不能使用本页。</p>
        </div>
        <Input
          placeholder="真实姓名"
          value={nickDraft}
          maxLength={32}
          onChange={(e) => setNickDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") enterWithLocation();
          }}
        />
        {denied ? (
          <p className="text-body text-destructive">
            你之前拒绝了定位，所以现在进不去。刷新页面也不会再弹出系统询问。请点地址栏左侧的锁或信息图标，把「位置」改为允许，再点下面的按钮。
          </p>
        ) : null}
        {unsupported ? (
          <p className="text-body text-destructive">
            这个浏览器不能提供位置，无法使用本页。请换用手机或电脑上的 Chrome、Safari 或 Edge。
          </p>
        ) : null}
        {locGate === "failed" ? (
          <p className="text-body text-destructive">
            暂时没有拿到位置。请确认系统定位已打开，然后重试。若刚才点了拒绝，按上面的方法在地址栏里改为允许。
          </p>
        ) : null}
        <Button
          className="min-h-11"
          disabled={locGate === "asking" || nickDraft.trim().length < 1 || unsupported}
          onClick={() => enterWithLocation()}
        >
          {locGate === "asking"
            ? "正在向浏览器申请位置…"
            : denied
              ? "我已允许，重新获取位置"
              : "同意定位并进入"}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col bg-background px-3 pb-[env(safe-area-inset-bottom)] pt-4 sm:px-4 sm:py-6">
      <header className="mb-3 shrink-0 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="text-caption text-muted-foreground">{meta.identifier}</p>
          <h1 className="truncate text-title font-medium">{meta.title}</h1>
          <p className="mt-1 text-caption text-muted-foreground">
            你是 {profile.nickname}
            {meta.assignee_name ? ` · 默认找 @${meta.assignee_name}` : null}
          </p>
        </div>
      </header>
      {work.length > 0 ? (
        <div className="mb-3 shrink-0 space-y-2">
          {work.map((w) => (
            <p
              key={`${w.agent_id}-${w.status}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-body"
              role="status"
            >
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
              <span className="min-w-0">
                <span className="font-medium">{w.agent_name}</span>
                <span className="text-muted-foreground"> · {w.status_label}</span>
                <span className="text-muted-foreground"> · {formatShareRelativeTime(w.since, nowMs)}开始</span>
              </span>
            </p>
          ))}
        </div>
      ) : null}

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
            if (c.type === "progress_update") {
              const line = body.replace(/\s+/g, " ").trim().slice(0, 80);
              return (
                <p key={c.id} className="px-1 text-caption text-muted-foreground">
                  {name} · {formatShareRelativeTime(c.created_at, nowMs)}
                  {line ? ` · ${line}` : " · 有一条处理记录"}
                </p>
              );
            }
            return (
              <div key={c.id} className="space-y-1">
              <div
                className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}
              >
                <ShareAvatar name={name} url={c.author_avatar_url} />
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
              <div className="space-y-2 pl-10">
                <MentionChips target={c.id} />
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={1}
                    placeholder={`回复 ${name}`}
                    className="min-h-11"
                    value={replyDrafts[c.id] ?? ""}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    className="min-h-11 shrink-0"
                    disabled={sending || !(replyDrafts[c.id] ?? "").trim()}
                    onClick={() => void send(c.id)}
                  >
                    发送
                  </Button>
                </div>
              </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 shrink-0 space-y-2 border-t border-border pt-3">
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        <MentionChips target="bottom" />
        <Textarea
          ref={taRef}
          rows={2}
          placeholder="新开一条。点上面的名字即可 @，可粘贴图片。"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
          <Button className="min-h-11" disabled={sending || !draft.trim()} onClick={() => void send()}>
            发送
          </Button>
        </div>
      </div>
    </main>
  );
}
