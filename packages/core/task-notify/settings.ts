import type { Workspace } from "../types";

/** Workspace settings key for SCS fork task-end push channels. */
export const TASK_NOTIFY_SETTINGS_KEY = "task_notify" as const;

export interface WechatUrlChannelConfig {
  enabled: boolean;
  /** wxsend-style GET endpoint (user-provided). */
  url: string;
}

export interface ClawbotChannelConfig {
  enabled: boolean;
  /** PushPlus token (user-provided). Endpoint + channel are fixed in code. */
  token: string;
}

export interface TaskNotifySettings {
  wechat_url: WechatUrlChannelConfig;
  clawbot: ClawbotChannelConfig;
  /**
   * Public web origin used in push deep links (scheme + host + port).
   * Captured from the real browser (`window.location.origin`), not server localhost.
   */
  app_base_url: string;
}

export const CLAWBOT_ENDPOINT = "https://www.pushplus.plus/send";
export const CLAWBOT_CHANNEL = "clawbot";

const EMPTY: TaskNotifySettings = {
  wechat_url: { enabled: false, url: "" },
  clawbot: { enabled: false, token: "" },
  app_base_url: "",
};

/** True for localhost / 127.0.0.1 / ::1 origins — not usable in outbound push links. */
export function isLoopbackAppBaseUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const host = new URL(s).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s);
  }
}

/** Current browser origin when available (client only). */
export function browserAppBaseUrl(): string {
  if (typeof window === "undefined" || !window.location?.origin) return "";
  return window.location.origin.replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readWechatUrl(raw: unknown): WechatUrlChannelConfig {
  const o = asRecord(raw);
  if (!o) return { ...EMPTY.wechat_url };
  return {
    enabled: o.enabled === true,
    url: typeof o.url === "string" ? o.url.trim() : "",
  };
}

function readClawbot(raw: unknown): ClawbotChannelConfig {
  const o = asRecord(raw);
  if (!o) return { ...EMPTY.clawbot };
  return {
    enabled: o.enabled === true,
    token: typeof o.token === "string" ? o.token.trim() : "",
  };
}

/**
 * Pure derivation from workspace.settings.task_notify.
 * Defaults: both channels off until the user enables them in Integrations.
 */
export function deriveTaskNotifySettings(
  workspace: Pick<Workspace, "settings"> | null | undefined,
): TaskNotifySettings {
  const root = asRecord(workspace?.settings);
  const block = asRecord(root?.[TASK_NOTIFY_SETTINGS_KEY]);
  if (!block) {
    return {
      wechat_url: { ...EMPTY.wechat_url },
      clawbot: { ...EMPTY.clawbot },
      app_base_url: "",
    };
  }
  return {
    wechat_url: readWechatUrl(block.wechat_url),
    clawbot: readClawbot(block.clawbot),
    app_base_url:
      typeof block.app_base_url === "string" ? block.app_base_url.trim().replace(/\/$/, "") : "",
  };
}

/** True when at least one channel is enabled and has its required secret/url. */
export function isTaskNotifyConnected(settings: TaskNotifySettings): boolean {
  const urlOn = settings.wechat_url.enabled && settings.wechat_url.url.length > 0;
  const clawOn = settings.clawbot.enabled && settings.clawbot.token.length > 0;
  return urlOn || clawOn;
}

export function mergeTaskNotifySettings(
  workspaceSettings: Record<string, unknown> | null | undefined,
  next: TaskNotifySettings,
): Record<string, unknown> {
  return {
    ...(workspaceSettings ?? {}),
    [TASK_NOTIFY_SETTINGS_KEY]: {
      wechat_url: {
        enabled: next.wechat_url.enabled,
        url: next.wechat_url.url.trim(),
      },
      clawbot: {
        enabled: next.clawbot.enabled,
        token: next.clawbot.token.trim(),
      },
      app_base_url: next.app_base_url.trim().replace(/\/$/, ""),
    },
  };
}
