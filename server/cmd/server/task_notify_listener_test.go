package main

import (
	"strings"
	"testing"
)

func TestBuildCompletedContentIncludesLink(t *testing.T) {
	got := buildCompletedContent(
		"Multica 改版",
		"飞云箭",
		"已经修好了",
		"https://app.example",
		"scsoi",
		"SCS-268",
	)
	for _, want := range []string{"Multica 改版", "飞云箭 已回复", "已经修好了", "https://app.example/scsoi/issues/SCS-268"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}

func TestBuildFailedContentSkipsRetryNoiseShape(t *testing.T) {
	got := buildFailedContent("Title", "Agent", "boom", "", "", "SCS-1")
	if !strings.Contains(got, "boom") || !strings.Contains(got, "运行失败") {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestIssueDeepLink(t *testing.T) {
	if got := issueDeepLink("https://x/", "ws", "A-1"); got != "https://x/ws/issues/A-1" {
		t.Fatalf("got %q", got)
	}
	if got := issueDeepLink("", "ws", "A-1"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestRedactNotifyHost(t *testing.T) {
	got := redactNotifyHost("https://scs-wx.example:4/wxsend")
	if got != "https://scs-wx.example:4/…" {
		t.Fatalf("got %q", got)
	}
}
