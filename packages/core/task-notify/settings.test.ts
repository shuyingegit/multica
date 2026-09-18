import { describe, expect, it } from "vitest";
import {
  CLAWBOT_CHANNEL,
  CLAWBOT_ENDPOINT,
  deriveTaskNotifySettings,
  isLoopbackAppBaseUrl,
  isTaskNotifyConnected,
  mergeTaskNotifySettings,
} from "./settings";

describe("deriveTaskNotifySettings", () => {
  it("defaults both channels off", () => {
    expect(deriveTaskNotifySettings({ settings: {} })).toEqual({
      wechat_url: { enabled: false, url: "" },
      clawbot: { enabled: false, token: "" },
      app_base_url: "",
    });
  });

  it("reads nested config", () => {
    const got = deriveTaskNotifySettings({
      settings: {
        task_notify: {
          wechat_url: { enabled: true, url: " https://wx.example/send " },
          clawbot: { enabled: true, token: " abc " },
          app_base_url: " https://app.example:3005/ ",
        },
      },
    });
    expect(got.wechat_url).toEqual({ enabled: true, url: "https://wx.example/send" });
    expect(got.clawbot).toEqual({ enabled: true, token: "abc" });
    expect(got.app_base_url).toBe("https://app.example:3005");
  });
});

describe("isTaskNotifyConnected", () => {
  it("requires enable + credential", () => {
    expect(
      isTaskNotifyConnected({
        wechat_url: { enabled: true, url: "" },
        clawbot: { enabled: false, token: "x" },
        app_base_url: "",
      }),
    ).toBe(false);
    expect(
      isTaskNotifyConnected({
        wechat_url: { enabled: true, url: "https://x" },
        clawbot: { enabled: false, token: "" },
        app_base_url: "",
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
        app_base_url: "https://browser.example:4",
      },
    );
    expect(merged.github_enabled).toBe(true);
    expect(merged.task_notify).toEqual({
      wechat_url: { enabled: true, url: "https://a" },
      clawbot: { enabled: false, token: "" },
      app_base_url: "https://browser.example:4",
    });
  });
});

describe("isLoopbackAppBaseUrl", () => {
  it("detects localhost variants", () => {
    expect(isLoopbackAppBaseUrl("http://localhost:3005")).toBe(true);
    expect(isLoopbackAppBaseUrl("https://127.0.0.1")).toBe(true);
    expect(isLoopbackAppBaseUrl("https://app.example:4")).toBe(false);
  });
});

describe("clawbot constants", () => {
  it("keeps endpoint and channel fixed in code", () => {
    expect(CLAWBOT_ENDPOINT).toBe("https://www.pushplus.plus/send");
    expect(CLAWBOT_CHANNEL).toBe("clawbot");
  });
});
