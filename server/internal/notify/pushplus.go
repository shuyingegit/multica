package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Channel is one outbound destination for a task-end alert.
type Channel interface {
	Name() string
	Send(ctx context.Context, msg Message) error
}

// Ensure *Client implements Channel (wxsend GET).
func (c *Client) Name() string { return "wechat_url" }

// ClawbotClient POSTs JSON to PushPlus clawbot channel.
type ClawbotClient struct {
	Token      string
	Endpoint   string
	Channel    string
	HTTPClient *http.Client
}

func NewClawbotClient(token string) *ClawbotClient {
	return &ClawbotClient{
		Token:    strings.TrimSpace(token),
		Endpoint: ClawbotEndpoint,
		Channel:  ClawbotChannelID,
		HTTPClient: &http.Client{
			Timeout: defaultTimeout,
		},
	}
}

func (c *ClawbotClient) Name() string { return "clawbot" }

func (c *ClawbotClient) Enabled() bool {
	return c != nil && c.Token != ""
}

type pushPlusBody struct {
	Token   string `json:"token"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Channel string `json:"channel"`
}

type pushPlusResp struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

// Send POSTs {token,title,content,channel} to PushPlus.
func (c *ClawbotClient) Send(ctx context.Context, msg Message) error {
	if !c.Enabled() {
		return nil
	}
	endpoint := c.Endpoint
	if endpoint == "" {
		endpoint = ClawbotEndpoint
	}
	channel := c.Channel
	if channel == "" {
		channel = ClawbotChannelID
	}
	const prefix = "【scsoi】"
	title := strings.TrimSpace(msg.Title)
	// Prefer 【scsoi】 prefix for ClawBot readability; reserve budget so the
	// packed ticket/agent/title still fits after the prefix.
	if !strings.HasPrefix(title, prefix) {
		reserve := utf8.RuneCountInString(prefix)
		title = prefix + truncateRunes(title, maxTitleRunes-reserve)
	} else {
		title = truncateRunes(title, maxTitleRunes)
	}
	content := truncateRunes(strings.TrimSpace(msg.Content), maxContentRunes*2)

	body, err := json.Marshal(pushPlusBody{
		Token:   c.Token,
		Title:   title,
		Content: content,
		Channel: channel,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", httpUserAgent)

	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Title/content rejected — retry once with a short payload so a long
		// preview cannot silently kill ClawBot delivery.
		if utf8.RuneCountInString(content) > 180 || utf8.RuneCountInString(title) > 40 {
			return c.sendOnce(ctx, endpoint, channel, truncateRunes(title, 32), truncateRunes(content, 160))
		}
		return fmt.Errorf("notify clawbot: unexpected status %d", resp.StatusCode)
	}
	var parsed pushPlusResp
	if err := json.Unmarshal(raw, &parsed); err == nil && parsed.Code != 0 && parsed.Code != 200 {
		if utf8.RuneCountInString(content) > 180 {
			return c.sendOnce(ctx, endpoint, channel, truncateRunes(title, 32), truncateRunes(content, 160))
		}
		return fmt.Errorf("notify clawbot: code=%d msg=%s", parsed.Code, parsed.Msg)
	}
	return nil
}

func (c *ClawbotClient) sendOnce(ctx context.Context, endpoint, channel, title, content string) error {
	body, err := json.Marshal(pushPlusBody{
		Token:   c.Token,
		Title:   title,
		Content: content,
		Channel: channel,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", httpUserAgent)
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("notify clawbot: unexpected status %d", resp.StatusCode)
	}
	var parsed pushPlusResp
	if err := json.Unmarshal(raw, &parsed); err == nil && parsed.Code != 0 && parsed.Code != 200 {
		return fmt.Errorf("notify clawbot: code=%d msg=%s body=%s", parsed.Code, parsed.Msg, truncateRunes(string(raw), 120))
	}
	return nil
}
