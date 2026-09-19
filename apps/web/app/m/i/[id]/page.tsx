"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMobileWorkspace } from "../../workspace";

export default function MobileIssueRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { ready, ws } = useMobileWorkspace();
  const id = params?.id ? decodeURIComponent(params.id) : "";

  useEffect(() => {
    if (!ready || !ws?.slug || !id) return;
    router.replace(`/${ws.slug}/issues/${encodeURIComponent(id)}#latest`);
  }, [id, ready, router, ws?.slug]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
      <p className="text-muted-foreground">正在打开票…</p>
    </main>
  );
}
