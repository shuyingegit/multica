"use client";

import type { ReactNode } from "react";
import { IssueDetailKeepAliveHost } from "@multica/views/issues/components/issue-detail-keepalive";

/**
 * Survives `/issues/:id` param changes so pin A↔B↔C can keep prior detail
 * trees mounted (see IssueDetailKeepAliveHost).
 */
export default function IssuesLayout({ children }: { children: ReactNode }) {
  return <IssueDetailKeepAliveHost>{children}</IssueDetailKeepAliveHost>;
}
