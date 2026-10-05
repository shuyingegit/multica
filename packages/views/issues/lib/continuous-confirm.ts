import type { IssueMetadata } from "@multica/core/types";

/** SCS fork: continuous-confirm outer-loop plan (V1). */

export const CONTINUOUS_CONFIRM_ABSOLUTE_MAX = 100;
export const CONTINUOUS_CONFIRM_DEFAULT_MAX = 20;
export const CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER = "【连续确认:DONE】";

export const CONTINUOUS_CONFIRM_DEFAULT_PROMPT =
  "【连续确认 第 {n}/{max} 轮】请继续推进同一任务，自行决策。若本轮后任务已彻底完成，请在终评明确写出：{done}。若必须等人才能继续，设为 blocked 并写清缺什么。不要只提问后空等。";

export const CONTINUOUS_CONFIRM_META = {
  enabled: "continuous_confirm",
  rounds: "continuous_confirm_rounds",
  waiting: "continuous_confirm_waiting",
  agent: "continuous_confirm_agent",
  max: "continuous_confirm_max",
  prompt: "continuous_confirm_prompt",
  doneMarker: "continuous_confirm_done_marker",
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
    agentId: metaString(meta, CONTINUOUS_CONFIRM_META.agent, ""),
  };
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
