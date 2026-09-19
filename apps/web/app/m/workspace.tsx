"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { setCurrentWorkspace } from "@multica/core/platform";
import type { Workspace } from "@multica/core/types";

export function readLastWorkspaceSlug(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )last_workspace_slug=([^;]*)/);
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

function pickWorkspace(workspaces: Workspace[], slug: string): Workspace | undefined {
  if (slug) {
    const hit = workspaces.find((w) => w.slug === slug);
    if (hit) return hit;
  }
  return workspaces[0];
}

/**
 * /m is outside the workspace layout, so the API client has no
 * X-Workspace-Slug until we set it. Pins and issues stay empty until then.
 */
export function useMobileWorkspace() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.isLoading);
  const [slugReady, setSlugReady] = useState(false);
  const [preferredSlug, setPreferredSlug] = useState("");
  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    setPreferredSlug(readLastWorkspaceSlug());
    setSlugReady(true);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/m");
  }, [authLoading, user, router]);

  const ws = useMemo(
    () => (slugReady ? pickWorkspace(workspaces, preferredSlug) : undefined),
    [workspaces, preferredSlug, slugReady],
  );

  if (ws) {
    setCurrentWorkspace(ws.slug, ws.id);
  }

  const ready = !authLoading && !!user && slugReady && !wsLoading && !!ws;
  return { user, ws, ready };
}
