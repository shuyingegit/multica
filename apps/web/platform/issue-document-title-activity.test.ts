import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TITLE_SPINNER_FRAMES,
  formatIssueDocumentTitle,
} from "./issue-document-title-activity";

describe("formatIssueDocumentTitle", () => {
  it("passes through when there is no activity", () => {
    expect(formatIssueDocumentTitle("SCS-268: Multica", null)).toBe("SCS-268: Multica");
  });

  it("appends relative age and a leading spinner while running", () => {
    expect(
      formatIssueDocumentTitle("SCS-268: Multica", { running: true, ageLabel: "3m" }, 0),
    ).toBe(`${DOCUMENT_TITLE_SPINNER_FRAMES[0]} SCS-268: Multica · 3m`);
    expect(
      formatIssueDocumentTitle("SCS-268: Multica", { running: false, ageLabel: "1h" }, 0),
    ).toBe("SCS-268: Multica · 1h");
  });
});
