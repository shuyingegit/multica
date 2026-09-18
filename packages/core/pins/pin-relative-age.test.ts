import { describe, expect, it } from "vitest";
import {
  describePinRelativeAge,
  formatPinRelativeAge,
  pinRelativeAgeTone,
} from "./pin-relative-age";

describe("formatPinRelativeAge", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("returns null for missing / invalid input", () => {
    expect(formatPinRelativeAge(null, now)).toBeNull();
    expect(formatPinRelativeAge(undefined, now)).toBeNull();
    expect(formatPinRelativeAge("not-a-date", now)).toBeNull();
  });

  it("formats compact Chinese ages", () => {
    expect(formatPinRelativeAge("2026-09-18T11:59:30Z", now)).toBe("刚刚");
    expect(formatPinRelativeAge("2026-09-18T11:57:00Z", now)).toBe("3分钟");
    expect(formatPinRelativeAge("2026-09-18T11:00:00Z", now)).toBe("1小时");
    expect(formatPinRelativeAge("2026-09-16T12:00:00Z", now)).toBe("2天");
  });
});

describe("pinRelativeAgeTone", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("marks sub-hour as fresh, same-day as recent, older as stale", () => {
    expect(pinRelativeAgeTone("2026-09-18T11:30:00Z", now)).toBe("fresh");
    expect(pinRelativeAgeTone("2026-09-18T11:00:00Z", now)).toBe("recent");
    expect(pinRelativeAgeTone("2026-09-17T12:00:00Z", now)).toBe("stale");
  });
});

describe("describePinRelativeAge", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("pairs label with tone", () => {
    expect(describePinRelativeAge("2026-09-18T11:57:00Z", now)).toEqual({
      label: "3分钟",
      tone: "fresh",
    });
    expect(describePinRelativeAge("2026-09-16T12:00:00Z", now)).toEqual({
      label: "2天",
      tone: "stale",
    });
  });
});
