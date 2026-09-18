"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { IssuesPage } from "@multica/views/issues/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";
import { openCreateIssueWithPreference } from "@multica/core/issues/stores/create-mode-store";
import { useIssueViewUrlSync } from "../../../../platform/use-issue-view-url-sync";

function IssueViewUrlSync() {
  // useSearchParams requires a Suspense boundary in the app router.
  useIssueViewUrlSync({ scope_type: "workspace" });
  return null;
}

function OpenCreateFromQuery() {
  const sp = useSearchParams();
  useEffect(() => {
    if (sp.get("create") === "1") {
      openCreateIssueWithPreference();
    }
  }, [sp]);
  return null;
}

export default function Page() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <IssueViewUrlSync />
        <OpenCreateFromQuery />
      </Suspense>
      <IssuesPage />
    </ErrorBoundary>
  );
}
