"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@multica/core/api";
import { AppLink } from "@multica/views/navigation";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useMobileWorkspace } from "../workspace";

export default function MobileNewIssuePage() {
  const router = useRouter();
  const { ready } = useMobileWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = title.trim();
    if (!text || saving || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const issue = await api.createIssue({
        title: text,
        description: description.trim() || undefined,
      });
      router.replace(`/m/i/${encodeURIComponent(issue.id)}`);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "创建失败");
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <AppLink href="/m" className="min-h-11 text-body text-muted-foreground">
          返回
        </AppLink>
        <h1 className="text-title font-medium">新建票</h1>
        <span className="w-10" />
      </header>
      <div className="flex flex-1 flex-col gap-3">
        <Input
          placeholder="标题"
          value={title}
          maxLength={200}
          className="min-h-11"
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          rows={6}
          placeholder="补充说明，可空"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error ? <p className="text-body text-destructive">{error}</p> : null}
      </div>
      <Button className="mt-4 min-h-11" disabled={saving || title.trim().length < 1} onClick={() => void submit()}>
        {saving ? "创建中…" : "创建"}
      </Button>
    </main>
  );
}
