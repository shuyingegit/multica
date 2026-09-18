package notify_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/notify"
)

func TestBuildURLEncodesTitleAndContent(t *testing.T) {
	got, err := notify.BuildURL("https://scs-wx.example/wxsend", "SCS-268 ✓ 完成", "hello world")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != "/wxsend" {
		t.Fatalf("path = %q", u.Path)
	}
	q := u.Query()
	if q.Get("title") != "SCS-268 ✓ 完成" {
		t.Fatalf("title = %q", q.Get("title"))
	}
	if q.Get("content") != "hello world" {
		t.Fatalf("content = %q", q.Get("content"))
	}
}

func TestBuildURLTruncatesLongContent(t *testing.T) {
	long := strings.Repeat("字", 500)
	got, err := notify.BuildURL("https://example/wxsend", "t", long)
	if err != nil {
		t.Fatal(err)
	}
	content := url.Values{}
	u, _ := url.Parse(got)
	content = u.Query()
	// 399 runes + ellipsis
	if want := 400; len([]rune(content.Get("content"))) != want {
		t.Fatalf("content runes = %d, want %d", len([]rune(content.Get("content"))), want)
	}
}

func TestClientSendDisabledIsNoop(t *testing.T) {
	c := notify.NewClient("")
	if c.Enabled() {
		t.Fatal("expected disabled")
	}
	if err := c.Send(context.Background(), notify.Message{Title: "x", Content: "y"}); err != nil {
		t.Fatal(err)
	}
}

func TestClientSendGET(t *testing.T) {
	var gotURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURL = r.URL.String()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"errcode":0,"errmsg":"ok"}`))
	}))
	defer srv.Close()

	c := notify.NewClient(srv.URL + "/wxsend")
	if err := c.Send(context.Background(), notify.Message{
		Title:   "SCS-1 完成",
		Content: "摘要",
	}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotURL, "title=") || !strings.Contains(gotURL, "content=") {
		t.Fatalf("unexpected request URL %q", gotURL)
	}
}

func TestStripMarkdownLight(t *testing.T) {
	in := "**bold** and `code`\n\n\nmore"
	got := notify.StripMarkdownLight(in)
	if strings.Contains(got, "**") || strings.Contains(got, "`") {
		t.Fatalf("still has markdown: %q", got)
	}
	if strings.Contains(got, "\n\n\n") {
		t.Fatalf("blank lines not collapsed: %q", got)
	}
}
