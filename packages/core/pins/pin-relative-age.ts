/**
 * Compact relative age for the pin rail (Doubao-style): "1分钟" / "3分钟" /
 * "1小时" — not the longer "N 分钟前" copy used in comment timestamps.
 *
 * Represents "how long since the last activity / reply on this issue".
 *
 * Tone steers visual weight: recent activity reads stronger; long-idle pins
 * fade so the rail emphasizes what still needs attention.
 */
export type PinAgeTone = "fresh" | "recent" | "stale";

export interface PinRelativeAge {
  label: string;
  tone: PinAgeTone;
}

function ageMinutes(
  dateStr: string | null | undefined,
  nowMs: number,
): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((nowMs - then) / 60_000));
}

/** Visual weight from age: <1h fresh, <1d recent, else stale. */
export function pinRelativeAgeTone(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): PinAgeTone | null {
  const minutes = ageMinutes(dateStr, nowMs);
  if (minutes == null) return null;
  if (minutes < 60) return "fresh";
  if (minutes < 24 * 60) return "recent";
  return "stale";
}

export function formatPinRelativeAge(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const minutes = ageMinutes(dateStr, nowMs);
  if (minutes == null) return null;
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月`;
  return `${Math.floor(months / 12)}年`;
}

export function describePinRelativeAge(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): PinRelativeAge | null {
  const label = formatPinRelativeAge(dateStr, nowMs);
  const tone = pinRelativeAgeTone(dateStr, nowMs);
  if (!label || !tone) return null;
  return { label, tone };
}
