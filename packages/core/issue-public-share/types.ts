export type IssuePublicShareAuthMode = "none" | "password";

export interface IssuePublicShare {
  code: string;
  auth_mode: IssuePublicShareAuthMode;
  cutoff_at: string;
  path: string;
  is_active: boolean;
  created_at: string;
}

export interface IssuePublicShareMeta {
  code: string;
  auth_mode: IssuePublicShareAuthMode;
  needs_password: boolean;
  unlocked: boolean;
  title: string;
  identifier: string;
  cutoff_at: string;
  /** Display name of the issue assignee when present. */
  assignee_name?: string | null;
  assignee_type?: string | null;
  assignee_id?: string | null;
}

export interface PublicShareAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface PublicShareComment {
  id: string;
  author_type: string;
  author_id: string;
  content: string;
  type: string;
  created_at: string;
  is_guest?: boolean;
  /** Resolved display name (member / agent / guest nickname). */
  author_name?: string | null;
  /** Member/agent avatar when the server has one. Guests use a generated mark. */
  author_avatar_url?: string | null;
  guest_nickname?: string | null;
  guest_location?: string | null;
  parent_id?: string | null;
  thread_resolved?: boolean;
  attachments?: PublicShareAttachment[];
}

export interface PublicShareWork {
  agent_id: string;
  agent_name: string;
  status: string;
  status_label: string;
  since: string;
}

export interface PublicShareProgress {
  id: string;
  agent_name: string;
  text: string;
  created_at: string;
}

export interface PublicShareGuestProfile {
  nickname: string;
  location?: string;
}

export function buildPublicIssueShareURL(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Clipboard text: title + URL (+ password when provided). */
export function buildPublicIssueShareClipboardText(opts: {
  title: string;
  identifier?: string;
  url: string;
  password?: string;
}): string {
  const head = [opts.identifier, opts.title].filter(Boolean).join(" · ") || opts.title;
  const lines = [head, opts.url];
  const pw = opts.password?.trim();
  if (pw) {
    lines.push(`密码：${pw}`);
  }
  return lines.join("\n");
}

const GUEST_PREFIX_RE = /^【外部访客(?:·([^】]*))?】\n/;

export function parseGuestComment(content: string): {
  isGuest: boolean;
  nickname: string | null;
  location: string | null;
  body: string;
} {
  const m = content.match(GUEST_PREFIX_RE);
  if (!m) {
    return { isGuest: false, nickname: null, location: null, body: content };
  }
  let rest = content.slice(m[0].length);
  let location: string | null = null;
  if (rest.startsWith("📍")) {
    rest = rest.slice("📍".length);
    const nl = rest.indexOf("\n");
    if (nl >= 0) {
      location = rest.slice(0, nl).trim() || null;
      rest = rest.slice(nl + 1);
    } else {
      location = rest.trim() || null;
      rest = "";
    }
  }
  return {
    isGuest: true,
    nickname: (m[1] ?? "").trim() || null,
    location,
    body: rest,
  };
}

export function stripGuestPrefix(content: string): string {
  return parseGuestComment(content).body;
}

export function formatGuestCommentPayload(
  nickname: string,
  body: string,
  location?: string,
): string {
  const name = nickname.trim() || "访客";
  let out = `【外部访客·${name}】\n`;
  const loc = location?.trim();
  if (loc) {
    out += `📍${loc}\n`;
  }
  out += body;
  return out;
}

/** Relative age for public share timeline (「刚刚」/「3分钟前」…). */
export function formatShareRelativeTime(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  return `${Math.floor(months / 12)}年前`;
}

const GUEST_PROFILE_KEY = "multica_issue_share_guest_v1";

export function loadGuestProfile(code: string): PublicShareGuestProfile | null {
  if (typeof window === "undefined" || !code) return null;
  try {
    const raw = window.localStorage.getItem(`${GUEST_PROFILE_KEY}:${code}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicShareGuestProfile;
    if (!parsed?.nickname?.trim()) return null;
    return {
      nickname: parsed.nickname.trim(),
      location: parsed.location?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function saveGuestProfile(code: string, profile: PublicShareGuestProfile): void {
  if (typeof window === "undefined" || !code) return;
  window.localStorage.setItem(
    `${GUEST_PROFILE_KEY}:${code}`,
    JSON.stringify({
      nickname: profile.nickname.trim(),
      location: profile.location?.trim() || undefined,
    }),
  );
}
