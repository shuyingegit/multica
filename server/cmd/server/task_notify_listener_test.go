package main

import (
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/notify"
)

func TestBuildTaskEndContentIncludesCommentDeepLink(t *testing.T) {
	got := notify.BuildTaskEndContent(
		"completed",
		"Multica 改版",
		"飞云箭",
		"已经修好了推送预览三行要义",
		"https://app.example",
		"scsoi",
		"SCS-268",
		"01a0b4ed-d4f5-7e18-bf3f-b35fd2b35f08",
	)
	for _, want := range []string{
		"修好了",
		"飞云箭 已回复",
		"https://app.example/scsoi/issues/SCS-268#comment-01a0b4ed-d4f5-7e18-bf3f-b35fd2b35f08",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}

func TestBuildTaskEndContentFallsBackWithoutBody(t *testing.T) {
	got := notify.BuildTaskEndContent("completed", "T", "A", "", "https://app.example", "ws", "A-1", "")
	if !strings.Contains(got, "T") {
		t.Fatalf("expected issue title fallback, got %q", got)
	}
	if !strings.Contains(got, "https://app.example/ws/issues/A-1") {
		t.Fatalf("expected issue link, got %q", got)
	}
	if strings.Contains(got, "#comment-") {
		t.Fatalf("unexpected comment hash: %q", got)
	}
}

func TestBuildFailedContentShape(t *testing.T) {
	got := notify.BuildTaskEndContent("failed", "Title", "Agent", "boom", "", "", "SCS-1", "")
	if !strings.Contains(got, "boom") || !strings.Contains(got, "运行失败") {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestIssueDeepLink(t *testing.T) {
	if got := issueDeepLink("https://x/", "ws", "A-1", ""); got != "https://x/ws/issues/A-1" {
		t.Fatalf("got %q", got)
	}
	if got := issueDeepLink("https://x", "ws", "A-1", "c-9"); got != "https://x/ws/issues/A-1#comment-c-9" {
		t.Fatalf("got %q", got)
	}
	if got := issueDeepLink("", "ws", "A-1", "c"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestRedactNotifyHost(t *testing.T) {
	got := redactNotifyHost("https://scs-wx.example:4/wxsend")
	if got != "https://scs-wx.example:4/…" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildTaskEndTitle(t *testing.T) {
	got := notify.BuildTaskEndTitle("SCS-268", "completed", "飞云箭", "Multica 改版", 8)
	if !strings.HasPrefix(got, "SCS-268 ✓ 完成") {
		t.Fatalf("got %q", got)
	}
	if !strings.Contains(got, "飞云箭") {
		t.Fatalf("missing agent: %q", got)
	}
}
