import type { IssueMetadata } from "@multica/core/types";

/** SCS fork: continuous-confirm outer-loop plan. */

export const CONTINUOUS_CONFIRM_ABSOLUTE_MAX = 1000;
export const CONTINUOUS_CONFIRM_DEFAULT_MAX = 20;
export const CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER = "【连续确认:DONE】";

export const CONTINUOUS_CONFIRM_DEFAULT_PROMPT =
  "【连续确认 第 {n}/{max} 轮】\n请围绕下列任务目标继续推进，自行决策，不要只回复「收到/继续」敷衍。\n\n## 任务目标（随用户补充更新）\n{brief}\n\n## 退出约定（必须先确认，再写标记）\n对照上面的任务目标逐条自检后，只有下面两种情况才允许结束：\n1. 已 100% 确认目标全部做完 → 在终评明确写出：{done}\n2. 已 100% 确认进入 blocked（没有任何可继续事项，必须等人）→ 设为 blocked，写清缺什么；不要写结束标记\n\n重要：\n- 仅仅把票标成 done / cancelled / in_review **不算结束**。系统会忽略这类状态变更并继续催你确认。\n- 若还有任何可做事项，继续做，**不要**写结束标记，也**不要**误关票。\n- 不要只提问后空等。";

export const CONTINUOUS_CONFIRM_META = {
  enabled: "continuous_confirm",
  rounds: "continuous_confirm_rounds",
  waiting: "continuous_confirm_waiting",
  agent: "continuous_confirm_agent",
  max: "continuous_confirm_max",
  prompt: "continuous_confirm_prompt",
  doneMarker: "continuous_confirm_done_marker",
  brief: "continuous_confirm_brief",
} as const;

export type ContinuousConfirmOptions = {
  enabled: boolean;
  max?: number;
  prompt?: string;
  done_marker?: string;
};

export type ContinuousConfirmPlanView = {
  enabled: boolean;
  waiting: boolean;
  rounds: number;
  max: number;
  prompt: string;
  doneMarker: string;
  brief: string;
  agentId: string;
};

const STORAGE_KEY = "scs.continuous_confirm.plan_v1";

export type ContinuousConfirmDraft = {
  max: number;
  prompt: string;
  doneMarker: string;
};

export function clampContinuousConfirmMax(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return CONTINUOUS_CONFIRM_DEFAULT_MAX;
  return Math.min(CONTINUOUS_CONFIRM_ABSOLUTE_MAX, Math.max(1, Math.floor(n)));
}

/** Max only rises while a plan is active. */
export function mergeContinuousConfirmMax(prev: number, incoming: number): number {
  return Math.max(clampContinuousConfirmMax(prev), clampContinuousConfirmMax(incoming));
}

export function loadContinuousConfirmDraft(): ContinuousConfirmDraft {
  if (typeof window === "undefined") {
    return {
      max: CONTINUOUS_CONFIRM_DEFAULT_MAX,
      prompt: CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker: CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        max: CONTINUOUS_CONFIRM_DEFAULT_MAX,
        prompt: CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
        doneMarker: CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
      };
    }
    const parsed = JSON.parse(raw) as Partial<ContinuousConfirmDraft>;
    return {
      max: clampContinuousConfirmMax(Number(parsed.max ?? CONTINUOUS_CONFIRM_DEFAULT_MAX)),
      prompt:
        typeof parsed.prompt === "string" && parsed.prompt.trim()
          ? parsed.prompt
          : CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker:
        typeof parsed.doneMarker === "string" && parsed.doneMarker.trim()
          ? parsed.doneMarker
          : CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    };
  } catch {
    return {
      max: CONTINUOUS_CONFIRM_DEFAULT_MAX,
      prompt: CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker: CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    };
  }
}

export function saveContinuousConfirmDraft(draft: ContinuousConfirmDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        max: clampContinuousConfirmMax(draft.max),
        prompt: draft.prompt,
        doneMarker: draft.doneMarker,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function metaBool(meta: IssueMetadata | undefined, key: string): boolean {
  return meta?.[key] === true;
}

function metaNumber(meta: IssueMetadata | undefined, key: string, fallback: number): number {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function metaString(meta: IssueMetadata | undefined, key: string, fallback: string): string {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v : fallback;
}

export function parseContinuousConfirmPlan(
  meta: IssueMetadata | undefined | null,
): ContinuousConfirmPlanView | null {
  if (!meta || !metaBool(meta, CONTINUOUS_CONFIRM_META.enabled)) return null;
  return {
    enabled: true,
    waiting: metaBool(meta, CONTINUOUS_CONFIRM_META.waiting),
    rounds: metaNumber(meta, CONTINUOUS_CONFIRM_META.rounds, 0),
    max: clampContinuousConfirmMax(
      metaNumber(meta, CONTINUOUS_CONFIRM_META.max, CONTINUOUS_CONFIRM_DEFAULT_MAX),
    ),
    prompt: metaString(meta, CONTINUOUS_CONFIRM_META.prompt, CONTINUOUS_CONFIRM_DEFAULT_PROMPT),
    doneMarker: metaString(
      meta,
      CONTINUOUS_CONFIRM_META.doneMarker,
      CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    ),
    brief: metaString(meta, CONTINUOUS_CONFIRM_META.brief, ""),
    agentId: metaString(meta, CONTINUOUS_CONFIRM_META.agent, ""),
  };
}

/** Prefer the living plan's max when composing, so a follow-up send won't reset to 20. */
export function draftFromPlanOrStorage(plan: ContinuousConfirmPlanView | null): ContinuousConfirmDraft {
  if (plan) {
    return {
      max: plan.max,
      prompt: plan.prompt || CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
      doneMarker: plan.doneMarker || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
    };
  }
  return loadContinuousConfirmDraft();
}

export function toContinuousConfirmPayload(
  enabled: boolean,
  draft: ContinuousConfirmDraft,
): boolean | ContinuousConfirmOptions {
  if (!enabled) return false;
  return {
    enabled: true,
    max: clampContinuousConfirmMax(draft.max),
    prompt: draft.prompt.trim() || CONTINUOUS_CONFIRM_DEFAULT_PROMPT,
    done_marker: draft.doneMarker.trim() || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
  };
}
