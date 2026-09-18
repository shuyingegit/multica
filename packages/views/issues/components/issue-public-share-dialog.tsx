"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { api } from "@multica/core/api";
import {
  buildPublicIssueShareURL,
  type IssuePublicShare,
  type IssuePublicShareAuthMode,
} from "@multica/core/issue-public-share";

export function IssuePublicShareDialog({
  issueId,
  open,
  onOpenChange,
}: {
  issueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [share, setShare] = useState<IssuePublicShare | null>(null);
  const [authMode, setAuthMode] = useState<IssuePublicShareAuthMode>("none");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open || !issueId) return;
    let cancelled = false;
    setLoading(true);
    api
      .getIssuePublicShare(issueId)
      .then((data) => {
        if (cancelled) return;
        if (data && "is_active" in data && data.is_active && "code" in data) {
          setShare(data as IssuePublicShare);
          setAuthMode((data as IssuePublicShare).auth_mode);
        } else {
          setShare(null);
          setAuthMode("none");
        }
      })
      .catch(() => {
        if (!cancelled) setShare(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, issueId]);

  async function enableOrUpdate() {
    setLoading(true);
    try {
      const next = await api.upsertIssuePublicShare(issueId, {
        auth_mode: authMode,
        ...(authMode === "password" ? { password } : {}),
      });
      setShare(next);
      setPassword("");
      toast.success("对外分享已开启");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "开启失败");
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    setLoading(true);
    try {
      await api.revokeIssuePublicShare(issueId);
      setShare(null);
      toast.success("已关闭对外分享");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "关闭失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!share) return;
    const url = buildPublicIssueShareURL(share.path);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  const url = share ? buildPublicIssueShareURL(share.path) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>对外对话</DialogTitle>
          <DialogDescription>
            生成公网链接。访客只能看到开启之后的对话；提问会写入本票，智能体仍带完整上下文回答。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>访问方式</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={authMode === "none" ? "default" : "outline"}
                onClick={() => setAuthMode("none")}
              >
                免密
              </Button>
              <Button
                type="button"
                size="sm"
                variant={authMode === "password" ? "default" : "outline"}
                onClick={() => setAuthMode("password")}
              >
                简单密码
              </Button>
            </div>
          </div>

          {authMode === "password" ? (
            <div className="space-y-2">
              <Label htmlFor="issue-share-password">密码（至少 4 位）</Label>
              <Input
                id="issue-share-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={share?.auth_mode === "password" ? "留空则保持原密码（需重新输入以更新）" : "设置访问密码"}
              />
            </div>
          ) : null}

          {share ? (
            <div className="space-y-2">
              <Label>公网链接</Label>
              <div className="flex gap-2">
                <Input readOnly value={url} className="font-mono text-caption" />
                <Button type="button" size="icon" variant="outline" onClick={() => void copyLink()}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {share ? (
            <Button type="button" variant="destructive" disabled={loading} onClick={() => void revoke()}>
              关闭分享
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={loading || (authMode === "password" && !share && password.length < 4)}
            onClick={() => void enableOrUpdate()}
          >
            <Link2 className="mr-1.5 size-4" />
            {share ? "更新设置" : "开启分享"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
