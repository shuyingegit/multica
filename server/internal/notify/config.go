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

	envFallbackURL = strings.TrimSpace(envFallbackURL)
	if !hasBlock && envFallbackURL != "" {
		// Deploy still has the old env-only URL; keep it working until
		// operators move the URL into Settings → Integrations.
		cfg.WechatURL.URL = envFallbackURL
		cfg.WechatURL.Enabled = true
	}
	return cfg
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
