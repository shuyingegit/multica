"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMobileWorkspace } from "../workspace";

export default function MobileNewIssuePage() {
  const router = useRouter();
  const { ready, ws } = useMobileWorkspace();

  useEffect(() => {
    if (!ready || !ws?.slug) return;
    router.replace(`/${ws.slug}/issues?create=1`);
  }, [ready, router, ws?.slug]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
      <p className="text-muted-foreground">正在打开新建票…</p>
    </main>
  );
}
