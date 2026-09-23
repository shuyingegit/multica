"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@multica/core/api";
import {
  formatCoords,
  formatShareRelativeTime,
  loadGuestProfile,
  parseGuestComment,
  parseStoredCoords,
  reverseGeocode,
  saveGuestProfile,
  type IssuePublicShareMeta,
  type PublicShareComment,
  type PublicShareGuestProfile,
  type PublicShareProgress,
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

function GuestLocationLabel({ location }: { location?: string | null }) {
  const [label, setLabel] = useState(location ?? "");
  useEffect(() => {
    const raw = (location ?? "").trim();
    setLabel(raw);
    const coords = parseStoredCoords(raw);
    if (!coords) return;
    let cancelled = false;
    void reverseGeocode(coords.lat, coords.lon).then((place) => {
      if (!cancelled && place) setLabel(place);
    });
    return () => {
      cancelled = true;
    };
  }, [location]);
  if (!label) return null;
  return <span>{label}</span>;
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

type LocGate = "idle" | "asking" | "denied" | "unsupported" | "failed";

function attachmentHref(code: string, id: string): string {
  return `/api/public/issue-shares/${encodeURIComponent(code)}/attachments/${encodeURIComponent(id)}`;
}

function ShareAttachments({
  code,
  items,
}: {
  code: string;
  items: PublicShareComment["attachments"];
}) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {items.map((item) => {
        const href = attachmentHref(code, item.id);
        if (item.content_type.startsWith("image/")) {
          return (
            <a key={item.id} href={href} target="_blank" rel="noreferrer">
              <img src={href} alt={item.filename} className="max-h-64 rounded-lg" />
            </a>
          );
        }
        return (
          <a
            key={item.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-caption underline"
          >
            {item.filename || "附件"}
          </a>
        );
      })}
    </div>
  );
}

function useShareFileDrop(onFiles: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    const clear = () => setIsDragOver(false);
    document.addEventListener("drop", clear);
    document.addEventListener("dragend", clear);
    const blockNavigate = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    document.addEventListener("dragover", blockNavigate);
    return () => {
      document.removeEventListener("drop", clear);
      document.removeEventListener("dragend", clear);
      document.removeEventListener("dragover", blockNavigate);
    };
  }, []);

  return {
    isDragOver,
    dropZoneProps: {
      onDragEnter: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) setIsDragOver(true);
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setIsDragOver(false);
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        const alreadyHandled = event.nativeEvent.defaultPrevented;
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        if (alreadyHandled) return;
        const dropped = Array.from(event.dataTransfer.files ?? []);
        if (dropped.length > 0) onFilesRef.current(dropped);
      },
    },
  };
}

function ShareDropZone({
  onFiles,
  className,
  children,
  label = "松开即可添加附件",
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  const { isDragOver, dropZoneProps } = useShareFileDrop(onFiles);
  return (
    <div className={`relative z-20 ${className ?? ""}`} {...dropZoneProps}>
      {children}
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-brand bg-background/90 px-4 text-center text-body">
          {label}
        </div>
      ) : null}
    </div>
  );
}

function hideLinkedAttachmentMarkdown(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\((?:https?:\/\/[^)\s]+)?\/api\/attachments\/[^)\s]+\)/g, "")
    .replace(/(^|\n)\[[^\]]*\]\((?:https?:\/\/[^)\s]+)?\/api\/attachments\/[^)\s]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function FileChips({ items, onRemove }: { items: File[]; onRemove: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((file, index) => (
        <button
          key={`${file.name}-${file.size}-${index}`}
          type="button"
          className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border px-3 text-caption"
          onClick={() => onRemove(index)}
        >
          <span className="truncate">{file.name || "附件"}</span>
          <span className="text-muted-foreground">移除</span>
        </button>
      ))}
    </div>
  );
}

function ClampText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.includes("\n") || text.length > 72;
  return (
    <div>
      <p className={`break-words text-caption text-muted-foreground ${open ? "whitespace-pre-wrap" : "line-clamp-3"}`}>
        {text}
      </p>
      {long ? (
        <button type="button" className="min-h-11 text-caption text-foreground" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  );
}

function ProgressFold({
  steps,
  nowMs,
}: {
  steps: PublicShareProgress[];
  nowMs: number;
}) {
  const [open, setOpen] = useState(false);
  const hidden = Math.max(0, steps.length - 3);
  const shown = open ? steps : steps.slice(-3);
  const long = steps.some((step) => step.text.includes("\n") || step.text.length > 48);
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1 rounded-xl border border-border bg-muted/20 px-3 py-2">
      {shown.map((step) => (
        <p
          key={step.id}
          className={`break-words text-caption text-muted-foreground ${open ? "whitespace-pre-wrap" : "line-clamp-3"}`}
        >
          {step.agent_name} · {formatShareRelativeTime(step.created_at, nowMs)} · {step.text}
        </p>
      ))}
      {hidden > 0 || long ? (
        <button
          type="button"
          className="min-h-11 text-caption text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "收起" : hidden > 0 ? `展开其余 ${hidden} 条` : "展开"}
        </button>
      ) : null}
    </div>
  );
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
  const [progress, setProgress] = useState<PublicShareProgress[]>([]);
  const [locGate, setLocGate] = useState<LocGate>("idle");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [profile, setProfile] = useState<PublicShareGuestProfile | null>(null);
  const [nickDraft, setNickDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTarget = useRef("bottom");
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
      setProgress(data.progress ?? []);
    } catch {
      // keep prior
    }
  }, [code, meta, token]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const name = meta?.title?.trim() || meta?.identifier?.trim() || (error ? "链接无效" : "对话");
    document.title = name;
  }, [error, meta?.identifier, meta?.title]);

  useEffect(() => {
    void loadTimeline();
    if (!meta || meta.needs_password) return;
    const id = window.setInterval(() => void loadTimeline(), 2000);
    return () => window.clearInterval(id);
  }, [loadTimeline, meta]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [comments.length, progress.length]);

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

  function addFiles(key: string, incoming: File[]) {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const next = [...(prev[key] ?? []), ...incoming].slice(0, 8);
      return { ...prev, [key]: next };
    });
  }

  function onPasteFiles(key: string, e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const incoming = Array.from(e.clipboardData?.files ?? []);
    if (incoming.length === 0) {
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) incoming.push(file);
      }
    }
    if (incoming.length === 0) return;
    e.preventDefault();
    addFiles(key, incoming);
  }

  function pickFiles(key: string) {
    fileTarget.current = key;
    fileInputRef.current?.click();
  }

  const { isDragOver, dropZoneProps } = useShareFileDrop((incoming) => addFiles("bottom", incoming));

  async function send(parentId?: string) {
    const key = parentId ?? "bottom";
    const pending = files[key] ?? [];
    const text = expandMentions((parentId ? replyDrafts[parentId] ?? "" : draft).trim());
    if ((!text && pending.length === 0) || sending || !profile?.nickname || !profile.location) return;
    setSending(true);
    try {
      const attachmentIds: string[] = [];
      for (const file of pending) {
        const uploaded = await api.uploadPublicIssueShareFile(code, file, token);
        if (uploaded.id) attachmentIds.push(uploaded.id);
      }
      await api.createPublicIssueShareComment(
        code,
        text,
        token,
        profile.nickname,
        profile.location,
        parentId,
        attachmentIds,
      );
      if (parentId) {
        setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
      } else {
        setDraft("");
      }
      setFiles((prev) => ({ ...prev, [key]: [] }));
      await loadTimeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  const hiddenResolved = comments.filter((c) => c.thread_resolved).length;
  const visibleComments = showResolved ? comments : comments.filter((c) => !c.thread_resolved);

  const timeline = useMemo(() => {
    const rows: Array<
      | { kind: "comment"; at: number; id: string; comment: PublicShareComment }
      | { kind: "progress"; at: number; id: string; steps: PublicShareProgress[] }
    > = [];
    const steps: PublicShareProgress[] = [];
    const flush = () => {
      const first = steps[0];
      if (!first) return;
      rows.push({
        kind: "progress",
        at: Date.parse(first.created_at) || 0,
        id: first.id,
        steps: steps.splice(0, steps.length),
      });
    };
    const sortedComments = [...visibleComments].sort(
      (a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0),
    );
    const windows: Array<[number, number]> = [];
    if (!showResolved) {
      let start: number | null = null;
      let end = 0;
      for (const comment of [...comments].sort(
        (a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0),
      )) {
        const at = Date.parse(comment.created_at) || 0;
        if (comment.thread_resolved) {
          if (start == null) start = at;
          end = at;
        } else if (start != null) {
          windows.push([start, end]);
          start = null;
        }
      }
      if (start != null) windows.push([start, end]);
    }
    const inResolvedWindow = (at: number) => windows.some(([start, end]) => at >= start && at <= end);
    const progressByTime = [...progress]
      .filter((step) => !inResolvedWindow(Date.parse(step.created_at) || 0))
      .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
    let pi = 0;
    for (const comment of sortedComments) {
      const at = Date.parse(comment.created_at) || 0;
      while (pi < progressByTime.length) {
        const step = progressByTime[pi];
        if (!step || (Date.parse(step.created_at) || 0) > at) break;
        steps.push(step);
        pi += 1;
      }
      flush();
      rows.push({ kind: "comment", at, id: comment.id, comment });
    }
    while (pi < progressByTime.length) {
      const step = progressByTime[pi];
      if (!step) break;
      steps.push(step);
      pi += 1;
    }
    flush();
    return rows;
  }, [comments, progress, showResolved, visibleComments]);

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
    <main
      className="relative mx-auto flex h-dvh max-w-2xl flex-col bg-background px-3 pb-[env(safe-area-inset-bottom)] pt-4 sm:px-4 sm:py-6"
      {...dropZoneProps}
    >
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
          {work.map((w) => {
            const latest = progress.findLast((p) => p.agent_name === w.agent_name)?.text;
            return (
            <p
              key={`${w.agent_id}-${w.status}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-body"
              role="status"
            >
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
              <span className="min-w-0">
                <span className="font-medium">{w.agent_name}</span>
                <span className="text-muted-foreground"> · {w.status_label}</span>
                {latest ? <span className="line-clamp-2 text-muted-foreground"> · {latest}</span> : null}
              </span>
            </p>
            );
          })}
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {hiddenResolved > 0 ? (
          <button
            type="button"
            className="min-h-11 w-full rounded-xl border border-border bg-muted/30 px-3 text-left text-caption text-muted-foreground"
            onClick={() => setShowResolved((value) => !value)}
          >
            {showResolved ? "收起已解决的对话" : `已解决的对话已折叠（${hiddenResolved}条）`}
          </button>
        ) : null}
        {timeline.length === 0 ? (
          <p className="py-8 text-center text-caption text-muted-foreground">
            还没有消息。输入问题开始对话（可粘贴图片和文件，输入 @ 点名）。
          </p>
        ) : (
          timeline.map((row) => {
            if (row.kind === "progress") {
              return <ProgressFold key={`p-${row.id}`} steps={row.steps} nowMs={nowMs} />;
            }
            const c = row.comment;
            const parsed = parseGuestComment(c.content);
            const guest = parsed.isGuest || !!c.is_guest;
            const body = hideLinkedAttachmentMarkdown(
              parsed.body.trim() === "（附件）" && (c.attachments?.length ?? 0) > 0 ? "" : parsed.body,
            );
            const name =
              c.author_name ||
              parsed.nickname ||
              c.guest_nickname ||
              (guest ? "访客" : c.author_type === "agent" ? "智能体" : "团队");
            const loc = parsed.location || c.guest_location;
            const mine = guest && parsed.nickname === profile.nickname;
            if (c.type === "progress_update") {
              return (
                <ClampText
                  key={c.id}
                  text={`${name} · ${formatShareRelativeTime(c.created_at, nowMs)}${body.trim() ? ` · ${body.trim()}` : " · 有一条处理记录"}`}
                />
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
                    {loc ? <GuestLocationLabel location={loc} /> : null}
                    <span>{formatShareRelativeTime(c.created_at, nowMs)}</span>
                  </p>
                  <div className="break-words">
                    <RichContent content={body} density="compact" />
                    <ShareAttachments code={code} items={c.attachments} />
                  </div>
                </div>
              </div>
              <ShareDropZone
                className="space-y-2 pl-10"
                label="松开即可加到这条回复"
                onFiles={(incoming) => addFiles(c.id, incoming)}
              >
                <MentionChips target={c.id} />
                <FileChips
                  items={files[c.id] ?? []}
                  onRemove={(index) =>
                    setFiles((prev) => ({
                      ...prev,
                      [c.id]: (prev[c.id] ?? []).filter((_, i) => i !== index),
                    }))
                  }
                />
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={1}
                    placeholder={`回复 ${name}`}
                    className="min-h-11"
                    value={replyDrafts[c.id] ?? ""}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                    }
                    onPaste={(e) => onPasteFiles(c.id, e)}
                  />
                  <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => pickFiles(c.id)}>
                    附件
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11 shrink-0"
                    disabled={sending || (!(replyDrafts[c.id] ?? "").trim() && (files[c.id] ?? []).length === 0)}
                    onClick={() => void send(c.id)}
                  >
                    发送
                  </Button>
                </div>
              </ShareDropZone>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 shrink-0 space-y-2 border-t border-border pt-3">
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        <MentionChips target="bottom" />
        <FileChips
          items={files.bottom ?? []}
          onRemove={(index) =>
            setFiles((prev) => ({
              ...prev,
              bottom: (prev.bottom ?? []).filter((_, i) => i !== index),
            }))
          }
        />
        <Textarea
          ref={taRef}
          rows={2}
          placeholder="把图片或文件拖进这里，也可以粘贴，或点「附件」。"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => onPasteFiles("bottom", e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => pickFiles("bottom")}>
              附件
            </Button>
            <p className="text-caption text-muted-foreground">拖进来，或 Ctrl/⌘ + Enter 发送</p>
          </div>
          <Button
            className="min-h-11"
            disabled={sending || (!draft.trim() && (files.bottom ?? []).length === 0)}
            onClick={() => void send()}
          >
            发送
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(fileTarget.current, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-brand bg-background/90 px-6 text-center text-body">
          松开即可添加附件
        </div>
      ) : null}
    </main>
  );
}
