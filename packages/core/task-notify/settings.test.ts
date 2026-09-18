import { describe, expect, it } from "vitest";
import {
  CLAWBOT_CHANNEL,
  CLAWBOT_ENDPOINT,
  deriveTaskNotifySettings,
  isTaskNotifyConnected,
  mergeTaskNotifySettings,
} from "./settings";

describe("deriveTaskNotifySettings", () => {
  it("defaults both channels off", () => {
    expect(deriveTaskNotifySettings({ settings: {} })).toEqual({
      wechat_url: { enabled: false, url: "" },
      clawbot: { enabled: false, token: "" },
    });
  });

  it("reads nested config", () => {
    const got = deriveTaskNotifySettings({
      settings: {
        task_notify: {
          wechat_url: { enabled: true, url: " https://wx.example/send " },
          clawbot: { enabled: true, token: " abc " },
        },
      },
    });
    expect(got.wechat_url).toEqual({ enabled: true, url: "https://wx.example/send" });
    expect(got.clawbot).toEqual({ enabled: true, token: "abc" });
  });
});

describe("isTaskNotifyConnected", () => {
  it("requires enable + credential", () => {
    expect(
      isTaskNotifyConnected({
        wechat_url: { enabled: true, url: "" },
        clawbot: { enabled: false, token: "x" },
      }),
    ).toBe(false);
    expect(
      isTaskNotifyConnected({
        wechat_url: { enabled: true, url: "https://x" },
        clawbot: { enabled: false, token: "" },
      }),
    ).toBe(true);
  });
});

describe("mergeTaskNotifySettings", () => {
  it("preserves unrelated settings keys", () => {
    const merged = mergeTaskNotifySettings(
      { github_enabled: true },
      {
        wechat_url: { enabled: true, url: "https://a" },
        clawbot: { enabled: false, token: "" },
      },
    );
    expect(merged.github_enabled).toBe(true);
    expect(merged.task_notify).toEqual({
      wechat_url: { enabled: true, url: "https://a" },
      clawbot: { enabled: false, token: "" },
    });
  });
});

describe("clawbot constants", () => {
  it("keeps endpoint and channel fixed in code", () => {
    expect(CLAWBOT_ENDPOINT).toBe("https://www.pushplus.plus/send");
    expect(CLAWBOT_CHANNEL).toBe("clawbot");
  });
});
