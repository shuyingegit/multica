import { describe, expect, it } from "vitest";
import {
  CONTINUOUS_CONFIRM_ABSOLUTE_MAX,
  resolveContinuousConfirmMaxInput,
  sanitizeContinuousConfirmMaxDraft,
} from "./continuous-confirm";

describe("sanitizeContinuousConfirmMaxDraft", () => {
  it("keeps empty input while typing", () => {
    expect(sanitizeContinuousConfirmMaxDraft("")).toBe("");
    expect(sanitizeContinuousConfirmMaxDraft("   ")).toBe("");
  });

  it("strips non-digits without clamping", () => {
    expect(sanitizeContinuousConfirmMaxDraft("12a3")).toBe("123");
    expect(sanitizeContinuousConfirmMaxDraft("200")).toBe("200");
  });
});

describe("resolveContinuousConfirmMaxInput", () => {
  it("does not snap mid-edit values until resolve", () => {
    // Typing over 100 toward 200: intermediate "2" / "20" stay as draft strings
    expect(sanitizeContinuousConfirmMaxDraft("2")).toBe("2");
    expect(sanitizeContinuousConfirmMaxDraft("20")).toBe("20");
    expect(sanitizeContinuousConfirmMaxDraft("200")).toBe("200");
    expect(resolveContinuousConfirmMaxInput("200", 1)).toBe(200);
  });

  it("respects floor and absolute max on blur/save", () => {
    expect(resolveContinuousConfirmMaxInput("5", 10)).toBe(10);
    expect(resolveContinuousConfirmMaxInput("", 7)).toBe(7);
    expect(resolveContinuousConfirmMaxInput("9999", 1)).toBe(CONTINUOUS_CONFIRM_ABSOLUTE_MAX);
  });
});
