package notify_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/notify"
)

func TestParseConfig_FromSettings(t *testing.T) {
	raw := []byte(`{
		"task_notify": {
			"wechat_url": {"enabled": true, "url": " https://wx.example/send "},
			"clawbot": {"enabled": true, "token": " tok "},
			"app_base_url": " https://browser.example:4/ "
		}
	}`)
	cfg := notify.ParseConfig(raw, "")
	if !cfg.WechatURL.Enabled || cfg.WechatURL.URL != "https://wx.example/send" {
		t.Fatalf("wechat_url: %+v", cfg.WechatURL)
	}
	if !cfg.Clawbot.Enabled || cfg.Clawbot.Token != "tok" {
		t.Fatalf("clawbot: %+v", cfg.Clawbot)
	}
	if cfg.AppBaseURL != "https://browser.example:4" {
		t.Fatalf("app_base_url: %q", cfg.AppBaseURL)
	}
}

func TestParseConfig_EnvFallback(t *testing.T) {
	cfg := notify.ParseConfig([]byte(`{}`), "https://legacy/wxsend")
	if !cfg.WechatURL.Enabled || cfg.WechatURL.URL != "https://legacy/wxsend" {
		t.Fatalf("expected env fallback, got %+v", cfg.WechatURL)
	}
	// Once the UI has saved a task_notify block, env must not override.
	cfg2 := notify.ParseConfig([]byte(`{
		"task_notify": {"wechat_url": {"enabled": false, "url": ""}}
	}`), "https://legacy/wxsend")
	if cfg2.WechatURL.Enabled || cfg2.WechatURL.URL != "" {
		t.Fatalf("env must not override saved settings, got %+v", cfg2.WechatURL)
	}
}

func TestActiveChannels(t *testing.T) {
	ch := notify.ActiveChannels(notify.Config{
		WechatURL: notify.WechatURLChannel{Enabled: true, URL: "https://a"},
		Clawbot:   notify.ClawbotChannel{Enabled: true, Token: "t"},
	})
	if len(ch) != 2 {
		t.Fatalf("want 2 channels, got %d", len(ch))
	}
}

func TestClawbotClient_Send(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
			t.Errorf("content-type %s", ct)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = w.Write([]byte(`{"code":200,"msg":"执行成功"}`))
	}))
	defer srv.Close()

	c := notify.NewClawbotClient("secret-token")
	c.Endpoint = srv.URL
	if err := c.Send(context.Background(), notify.Message{
		Title:   "SCS-1 ✓ 完成",
		Content: "hello",
	}); err != nil {
		t.Fatal(err)
	}
	if gotBody["token"] != "secret-token" {
		t.Fatalf("token %+v", gotBody["token"])
	}
	if gotBody["channel"] != notify.ClawbotChannelID {
		t.Fatalf("channel %+v", gotBody["channel"])
	}
	if gotBody["template"] != "txt" {
		t.Fatalf("template %+v", gotBody["template"])
	}
	title, _ := gotBody["title"].(string)
	if !strings.HasPrefix(title, "【scsoi】") {
		t.Fatalf("title should get scsoi prefix, got %q", title)
	}
}

func TestClawbotConstants(t *testing.T) {
	if notify.ClawbotEndpoint != "https://www.pushplus.plus/send" {
		t.Fatalf("endpoint %s", notify.ClawbotEndpoint)
	}
	if notify.ClawbotChannelID != "clawbot" {
		t.Fatalf("channel %s", notify.ClawbotChannelID)
	}
}

func TestResolveAppBaseURL(t *testing.T) {
	got := notify.ResolveAppBaseURL("https://browser.example:4", "http://localhost:3005")
	if got != "https://browser.example:4" {
		t.Fatalf("prefer browser stamp, got %q", got)
	}
	got = notify.ResolveAppBaseURL("http://localhost:3005", "https://public.example")
	if got != "https://public.example" {
		t.Fatalf("prefer non-loopback env, got %q", got)
	}
	got = notify.ResolveAppBaseURL("", "http://127.0.0.1:3005")
	if got != "http://127.0.0.1:3005" {
		t.Fatalf("last-resort loopback, got %q", got)
	}
	if !notify.IsLoopbackBaseURL("http://localhost:3005") {
		t.Fatal("expected loopback")
	}
	if notify.IsLoopbackBaseURL("https://app.example:4") {
		t.Fatal("expected non-loopback")
	}
}
