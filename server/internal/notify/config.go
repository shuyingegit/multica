package notify

import (
	"encoding/json"
	"strings"
)

// Workspace settings key (mirrors packages/core/task-notify).
const SettingsKey = "task_notify"

// Config is the per-workspace task-end notify setup from workspace.settings.
type Config struct {
	WechatURL WechatURLChannel `json:"wechat_url"`
	Clawbot   ClawbotChannel   `json:"clawbot"`
	// AppBaseURL is the public web origin (scheme+host+port) stamped from the
	// real browser. Prefer this over server-side localhost env for push links.
	AppBaseURL string `json:"app_base_url"`
}

type WechatURLChannel struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

type ClawbotChannel struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

// Fixed PushPlus / ClawBot wiring — not user-editable.
const (
	ClawbotEndpoint   = "https://www.pushplus.plus/send"
	ClawbotChannelID  = "clawbot"
)

type settingsRoot struct {
	TaskNotify json.RawMessage `json:"task_notify"`
}

// ParseConfig reads task_notify from workspace.settings JSONB.
// envFallbackURL: legacy MULTICA_TASK_NOTIFY_URL — used only when the
// workspace has never saved a task_notify block (migration path).
func ParseConfig(settingsJSON []byte, envFallbackURL string) Config {
	var cfg Config
	hasBlock := false
	if len(settingsJSON) > 0 {
		var root settingsRoot
		if json.Unmarshal(settingsJSON, &root) == nil && len(root.TaskNotify) > 0 {
			hasBlock = true
			_ = json.Unmarshal(root.TaskNotify, &cfg)
		}
	}
	cfg.WechatURL.URL = strings.TrimSpace(cfg.WechatURL.URL)
	cfg.Clawbot.Token = strings.TrimSpace(cfg.Clawbot.Token)
	cfg.AppBaseURL = strings.TrimRight(strings.TrimSpace(cfg.AppBaseURL), "/")

	envFallbackURL = strings.TrimSpace(envFallbackURL)
	if !hasBlock && envFallbackURL != "" {
		// Deploy still has the old env-only URL; keep it working until
		// operators move the URL into Settings → Integrations.
		cfg.WechatURL.URL = envFallbackURL
		cfg.WechatURL.Enabled = true
	}
	return cfg
}

// IsLoopbackBaseURL reports localhost / loopback origins that must not be
// preferred for outbound push deep links.
func IsLoopbackBaseURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	lower := strings.ToLower(raw)
	// Strip scheme for a cheap host check without pulling net/url into callers.
	if i := strings.Index(lower, "://"); i >= 0 {
		lower = lower[i+3:]
	}
	if j := strings.IndexAny(lower, "/:"); j >= 0 {
		lower = lower[:j]
	}
	lower = strings.Trim(lower, "[]")
	return lower == "localhost" || lower == "127.0.0.1" || lower == "::1"
}

// ResolveAppBaseURL picks the public origin for issue deep links in pushes.
// Prefer a non-loopback workspace stamp (from the browser); then a non-loopback
// env; only then fall back to whatever remains (may still be empty).
func ResolveAppBaseURL(fromSettings, fromEnv string) string {
	fromSettings = strings.TrimRight(strings.TrimSpace(fromSettings), "/")
	fromEnv = strings.TrimRight(strings.TrimSpace(fromEnv), "/")
	if fromSettings != "" && !IsLoopbackBaseURL(fromSettings) {
		return fromSettings
	}
	if fromEnv != "" && !IsLoopbackBaseURL(fromEnv) {
		return fromEnv
	}
	if fromSettings != "" {
		return fromSettings
	}
	return fromEnv
}

// ActiveChannels builds ready-to-send channels from config.
func ActiveChannels(cfg Config) []Channel {
	var out []Channel
	if cfg.WechatURL.Enabled && cfg.WechatURL.URL != "" {
		out = append(out, NewClient(cfg.WechatURL.URL))
	}
	if cfg.Clawbot.Enabled && cfg.Clawbot.Token != "" {
		out = append(out, NewClawbotClient(cfg.Clawbot.Token))
	}
	return out
}
