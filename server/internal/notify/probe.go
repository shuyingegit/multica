package notify

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// ProbeChannel sends one short test message through a single channel and
// returns a human-readable result. It does not require the channel's
// "enabled" switch — the settings page uses it to check the URL or token
// before (or without) turning real task-end pushes on.
func ProbeChannel(ctx context.Context, channel, rawURL, token string) (string, error) {
	msg := Message{
		Title:   "测试推送",
		Content: "这是设置页发出的测试，不是真实任务。看到这条，说明这条渠道的接口是通的。",
	}
	switch strings.TrimSpace(channel) {
	case "wechat_url":
		rawURL = strings.TrimSpace(rawURL)
		if err := validateNotifyURL(rawURL); err != nil {
			return "", err
		}
		if err := NewClient(rawURL).Send(ctx, msg); err != nil {
			return "", err
		}
		return "微信服务号接口已返回成功", nil
	case "clawbot":
		token = strings.TrimSpace(token)
		if token == "" {
			return "", fmt.Errorf("还没有 Token")
		}
		if err := NewClawbotClient(token).Send(ctx, msg); err != nil {
			return "", err
		}
		return "ClawBot 接口已返回成功。若微信里没有这条，先在 ClawBot 对话里回一条保活。", nil
	default:
		return "", fmt.Errorf("未知渠道")
	}
}

func validateNotifyURL(raw string) error {
	if raw == "" {
		return fmt.Errorf("还没有推送 URL")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("推送 URL 不合法")
	}
	return nil
}
