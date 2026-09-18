import { beforeEach, describe, expect, it } from "vitest";
import { usePinUnreadStore } from "./pin-unread-store";

describe("usePinUnreadStore", () => {
  beforeEach(() => {
    usePinUnreadStore.getState().reset();
  });

  it("treats freshly seeded pins as read (no badge)", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a", "b"]);
    expect(usePinUnreadStore.getState().unreadCounts).toEqual({});
  });

  it("badges only after an incoming comment while away", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("b");
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(2);
  });

  it("ignores own comments and comments on the open issue", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("a");
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();

    usePinUnreadStore.getState().setViewingIssue("b");
    usePinUnreadStore.getState().noteIncomingComment("a", { fromSelf: true });
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();
  });

  it("clears the badge when the pin is opened", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    usePinUnreadStore.getState().setViewingIssue("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();
  });

  it("does not badge unseeded issues (baseline not established)", () => {
    usePinUnreadStore.getState().noteIncomingComment("ghost");
    expect(usePinUnreadStore.getState().unreadCounts.ghost).toBeUndefined();
  });
});
