package issueshare

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPublicProgressText(t *testing.T) {
	if got := PublicProgressText("thinking", "", "secret plan token=abc"); got != "思考中" {
		t.Fatalf("thinking %q", got)
	}
	if got := PublicProgressText("tool_use", "Read", "ignored"); got != "正在使用 Read" {
		t.Fatalf("tool %q", got)
	}
	if got := PublicProgressText("tool_use", "", ""); got != "正在使用 工具" {
		t.Fatalf("empty tool %q", got)
	}
	if got := PublicProgressText("text", "", "  看一下  页面  "); got != "看一下 页面" {
		t.Fatalf("text %q", got)
	}
	got := PublicProgressText("text", "", "key token=supersecret")
	if !strings.Contains(got, "[已隐藏]") || strings.Contains(got, "supersecret") {
		t.Fatalf("redact %q", got)
	}
	if got := PublicProgressText("text", "", ""); got != "" {
		t.Fatalf("empty text %q", got)
	}
	long := strings.Repeat("啊", 200)
	clipped := PublicProgressText("text", "", long)
	if n := utf8.RuneCountInString(clipped); n > 161 {
		t.Fatalf("clip len %d", n)
	}
}
