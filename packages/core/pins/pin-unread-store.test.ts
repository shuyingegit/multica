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

  it("badges after an incoming comment while away", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("b");
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(2);
  });

  it("badges even when the issue is currently open", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("a");
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
  });

  it("ignores own comments", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("b");
    usePinUnreadStore.getState().noteIncomingComment("a", { fromSelf: true });
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();
  });

  it("clears the badge when navigating onto the pin", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    usePinUnreadStore.getState().setViewingIssue("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();
  });

  it("does not clear on re-sync of the same viewing issue", () => {
    usePinUnreadStore.getState().seedIfNeeded(["a"]);
    usePinUnreadStore.getState().setViewingIssue("a");
    usePinUnreadStore.getState().noteIncomingComment("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    // Effect re-fire / cache refresh must not wipe the badge.
    usePinUnreadStore.getState().setViewingIssue("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBe(1);
    usePinUnreadStore.getState().markRead("a");
    expect(usePinUnreadStore.getState().unreadCounts.a).toBeUndefined();
  });

  it("does not badge unseeded issues (baseline not established)", () => {
    usePinUnreadStore.getState().noteIncomingComment("ghost");
    expect(usePinUnreadStore.getState().unreadCounts.ghost).toBeUndefined();
  });
});
