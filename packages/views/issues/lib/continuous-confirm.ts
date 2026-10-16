import type { IssueMetadata } from "@multica/core/types";

/** SCS fork: continuous-confirm outer-loop plan. */

export const CONTINUOUS_CONFIRM_ABSOLUTE_MAX = 1000;
export const CONTINUOUS_CONFIRM_DEFAULT_MAX = 20;
export const CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER = "【连续确认:DONE】";

export const CONTINUOUS_CONFIRM_DEFAULT_PROMPT =
  "【连续确认 第 {n}/{max} 轮】\n请围绕下列任务目标继续推进，自行决策，不要只回复「收到/继续」敷衍。\n\n## 任务目标（随用户补充更新）\n{brief}\n\n## 本轮执行原则（连续确认宗旨）\n1. **长期运行、不跑偏**：紧扣主线宗旨；用户补充要先判断再融合进主线/待办，不要无脑堆进永久任务。\n2. **依次推进未完成项**：已完成（含用户未再强调的一次性 Bug）跳过或移入「已完成」；只持续做还没做完的。\n3. **整体不漏、不理解错**：更新 brief 时保留主线与意见记录；待办勾销要写进【Agent整理】。\n\n## 退出约定（必须先确认，再写标记）\n对照上面的任务目标逐条自检后，只有下面两种情况才允许结束：\n1. 已 100% 确认目标全部做完 → 在终评单独一行写出：{done}\n2. 已 100% 确认进入 blocked（没有任何可继续事项，必须等人）→ 设为 blocked，写清缺什么；不要写结束标记\n\n重要：\n- 仅仅把票标成 done / cancelled / in_review **不算结束**。系统会忽略这类状态变更并继续催你确认。\n- 若还有任何可做事项，继续做，**不要**写结束标记，也**不要**误关票。\n- 未结束时禁止在正文里复述结束标记字符串（包括「未写 xxx」）。\n- 不要只提问后空等。";

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

/**
 * Parse a max-rounds draft while the user is typing. Empty / partial input
 * stays as-is so the field does not snap back on every keystroke. Callers
 * clamp with {@link resolveContinuousConfirmMaxInput} on blur / save.
 */
export function sanitizeContinuousConfirmMaxDraft(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Allow only digits while editing (no decimals / signs).
  if (!/^\d+$/.test(trimmed)) return trimmed.replace(/\D/g, "");
  return trimmed;
}

/** Finalize a typed max against absolute bounds and an optional floor (active plan). */
export function resolveContinuousConfirmMaxInput(raw: string, floor = 1): number {
  const digits = sanitizeContinuousConfirmMaxDraft(raw);
  if (digits === "") return Math.max(1, floor);
  const n = Number(digits);
  if (!Number.isFinite(n)) return Math.max(1, floor);
  return Math.max(floor, clampContinuousConfirmMax(n));
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
  let prompt = draft.prompt.trim() || CONTINUOUS_CONFIRM_DEFAULT_PROMPT;
  // Don't ship legacy one-liners that lack {brief}.
  if (!prompt.includes("{brief}")) {
    prompt = CONTINUOUS_CONFIRM_DEFAULT_PROMPT;
  }
  return {
    enabled: true,
    max: clampContinuousConfirmMax(draft.max),
    prompt,
    done_marker: draft.doneMarker.trim() || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER,
  };
}

/** Render the per-round prompt the agent will actually see. */
export function renderContinuousConfirmPrompt(
  template: string,
  round: number,
  max: number,
  doneMarker: string,
  brief: string,
): string {
  const tpl = template.trim() || CONTINUOUS_CONFIRM_DEFAULT_PROMPT;
  const n = round > 0 ? round : 1;
  const m = clampContinuousConfirmMax(max);
  const done = doneMarker.trim() || CONTINUOUS_CONFIRM_DEFAULT_DONE_MARKER;
  const b =
    brief.trim() ||
    "（暂无单独目标摘要；请结合票标题、描述与最近评论继续推进。）";
  return tpl
    .replaceAll("{n}", String(n))
    .replaceAll("{max}", String(m))
    .replaceAll("{done}", done)
    .replaceAll("{brief}", b)
    .trim();
}

/**
 * One-line status-bar snippet: prefer「最新用户意见」so the strip tracks the
 * user's latest intent instead of an old header / agent polish.
 */
export function summarizeContinuousConfirmBrief(brief: string, maxLen = 80): string {
  const raw = brief.trim();
  if (!raw) return "";
  const latestHeader = "### 最新用户意见";
  let focus = raw;
  const latestIdx = raw.indexOf(latestHeader);
  if (latestIdx >= 0) {
    let rest = raw.slice(latestIdx + latestHeader.length).trim();
    // Stop before the next heading / agent section so we don't leak polish text.
    rest = rest.split(/\n(?=#{1,3}\s|【Agent整理】|## Agent整理)/)[0]?.trim() || rest;
    if (rest) focus = rest;
  } else {
    // Drop leading structural headers for legacy briefs.
    focus = raw
      .replace(/^##\s*用户目标\s*/m, "")
      .replace(/^【Agent整理】\s*/m, "")
      .trim();
  }
  const flat = focus.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, Math.max(0, maxLen - 1)) + "…";
}
