package notify_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/notify"
)

func TestReplyGistPrefersOutcomeLine(t *testing.T) {
	raw := `收到任务，已接手

## 改动说明
已推 main：推送深链改用浏览器真实 origin，不再用 localhost。

请 [@docker部署专员](mention://agent/x) 执行
./scripts/redeploy-fork-fast.sh all
https://example.com/x`
	got := notify.ReplyGist(raw, 80)
	if !strings.Contains(got, "浏览器真实 origin") && !strings.Contains(got, "已推") {
		t.Fatalf("expected outcome gist, got %q", got)
	}
	if strings.Contains(got, "收到任务") {
		t.Fatalf("should skip ack line, got %q", got)
	}
	if strings.Contains(got, "redeploy") || strings.Contains(got, "https://") {
		t.Fatalf("should skip noise, got %q", got)
	}
}

func TestBuildTaskEndTitlePacksWhoAndTicket(t *testing.T) {
	got := notify.BuildTaskEndTitle("SCS-268", "completed", "1支飞云箭", "Multica 改版", 8)
	if !strings.Contains(got, "SCS-268") || !strings.Contains(got, "完成") {
		t.Fatalf("missing ticket/status: %q", got)
	}
	if !strings.Contains(got, "1支飞云箭") {
		t.Fatalf("missing agent: %q", got)
	}
	if !strings.Contains(got, "Multica") {
		t.Fatalf("missing issue title: %q", got)
	}
	if utf8.RuneCountInString(got) > 56 {
		t.Fatalf("title too long for clawbot prefix reserve: %d %q", utf8.RuneCountInString(got), got)
	}
}

func TestBuildTaskEndContentPreviewOrder(t *testing.T) {
	got := notify.BuildTaskEndContent(
		"completed",
		"Multica 改版",
		"飞云箭",
		"已改：推送深链前缀取浏览器真实 origin，不再 localhost。\n\n详情很长……",
		"https://app.example:3005",
		"scsoi",
		"SCS-268",
		"c-1",
	)
	lines := strings.Split(got, "\n")
	if len(lines) < 2 {
		t.Fatalf("want at least 2 lines, got %q", got)
	}
	if !strings.Contains(lines[0], "浏览器") && !strings.Contains(lines[0], "已改") {
		t.Fatalf("line1 should be gist, got %q", lines[0])
	}
	if !strings.Contains(lines[1], "飞云箭") {
		t.Fatalf("line2 should name agent, got %q", lines[1])
	}
	if !strings.Contains(got, "https://app.example:3005/scsoi/issues/SCS-268#comment-c-1") {
		t.Fatalf("missing deep link: %q", got)
	}
}
