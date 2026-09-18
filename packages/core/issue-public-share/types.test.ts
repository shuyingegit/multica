import { describe, expect, it } from "vitest";
import {
  buildPublicIssueShareClipboardText,
  formatGuestCommentPayload,
  formatShareRelativeTime,
  parseGuestComment,
} from "./types";

describe("parseGuestComment", () => {
  it("parses nickname and location", () => {
    const got = parseGuestComment("【外部访客·张三】\n📍苏州·星湖街\n你好");
    expect(got).toEqual({
      isGuest: true,
      nickname: "张三",
      location: "苏州·星湖街",
      body: "你好",
    });
  });

  it("supports legacy prefix", () => {
    const got = parseGuestComment("【外部访客】\n旧消息");
    expect(got.isGuest).toBe(true);
    expect(got.body).toBe("旧消息");
  });
});

describe("formatGuestCommentPayload", () => {
  it("builds prefix", () => {
    expect(formatGuestCommentPayload("李四", "hi", "无锡")).toBe(
      "【外部访客·李四】\n📍无锡\nhi",
    );
  });
});

describe("buildPublicIssueShareClipboardText", () => {
  it("includes title url and password", () => {
    expect(
      buildPublicIssueShareClipboardText({
        identifier: "SCS-268",
        title: "Multica 改版",
        url: "https://x/p/i/abc",
        password: "secret",
      }),
    ).toBe("SCS-268 · Multica 改版\nhttps://x/p/i/abc\n密码：secret");
  });
});

describe("formatShareRelativeTime", () => {
  it("formats minutes", () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    expect(formatShareRelativeTime("2026-09-18T11:59:30Z", now)).toBe("刚刚");
    expect(formatShareRelativeTime("2026-09-18T11:50:00Z", now)).toBe("10分钟前");
  });
});
