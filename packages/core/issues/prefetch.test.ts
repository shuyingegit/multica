import { describe, expect, it } from "vitest";
import { createQueryClient } from "../query-client";
import type { Issue } from "../types";
import { issueKeys } from "./queries";
import {
  findCachedIssueByIdentifier,
  issueSegmentFromPath,
  mirrorIssueDetailCache,
} from "./prefetch";

const ISSUE_UUID = "cb240efb-154c-42a8-ae92-42b02676feca";
const issue = {
  id: ISSUE_UUID,
  workspace_id: "ws-1",
  identifier: "TRS-134",
  title: "Example",
  status: "todo",
} as Issue;

describe("issueSegmentFromPath", () => {
  it("extracts the issue segment from workspace paths", () => {
    expect(issueSegmentFromPath("/acme/issues/TRS-134")).toBe("TRS-134");
    expect(issueSegmentFromPath("/acme/issues/TRS-134?x=1")).toBe("TRS-134");
    expect(issueSegmentFromPath("/acme/issues/TRS-134#comment-1")).toBe("TRS-134");
    expect(issueSegmentFromPath("/acme/issues")).toBeNull();
  });
});

describe("findCachedIssueByIdentifier / mirrorIssueDetailCache", () => {
  it("finds a UUID-keyed cache entry by identifier", () => {
    const qc = createQueryClient();
    qc.setQueryData(issueKeys.detail("ws-1", ISSUE_UUID), issue);
    expect(findCachedIssueByIdentifier(qc, "ws-1", "TRS-134")).toEqual(issue);
    expect(findCachedIssueByIdentifier(qc, "ws-1", "trs-134")).toEqual(issue);
  });

  it("mirrors into both UUID and identifier keys", () => {
    const qc = createQueryClient();
    mirrorIssueDetailCache(qc, "ws-1", issue);
    expect(qc.getQueryData(issueKeys.detail("ws-1", ISSUE_UUID))).toEqual(issue);
    expect(qc.getQueryData(issueKeys.detail("ws-1", "TRS-134"))).toEqual(issue);
  });
});
