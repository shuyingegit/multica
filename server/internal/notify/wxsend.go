// Package notify sends optional outbound task-completion alerts for the SCS
// fork. Destinations are configured per workspace in Settings → Integrations
// (workspace.settings.task_notify). Legacy MULTICA_TASK_NOTIFY_URL in the
// deploy .env still works as a fallback for the WeChat URL channel.
package notify

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultTimeout  = 8 * time.Second
	maxTitleRunes   = 64
	maxContentRunes = 400
	httpUserAgent   = "multica-task-notify/1.0"
)

// Client posts (GET with query params) to a wxsend-style endpoint.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient returns a client for baseURL (e.g. https://host/wxsend).
// Empty baseURL disables sends — Send becomes a no-op that returns nil.
func NewClient(baseURL string) *Client {
	baseURL = strings.TrimSpace(baseURL)
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTPClient: &http.Client{
			Timeout: defaultTimeout,
		},
	}
}

// Enabled reports whether a destination is configured.
func (c *Client) Enabled() bool {
	return c != nil && c.BaseURL != ""
}

// Message is one push payload.
type Message struct {
	Title   string
	Content string
}

// BuildURL constructs the GET URL with title/content query params.
func BuildURL(baseURL, title, content string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return "", fmt.Errorf("notify: empty base URL")
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("notify: parse base URL: %w", err)
	}
	q := u.Query()
	q.Set("title", truncateRunes(strings.TrimSpace(title), maxTitleRunes))
	q.Set("content", truncateRunes(strings.TrimSpace(content), maxContentRunes))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Send performs a GET against the configured endpoint. Empty BaseURL is a no-op.
func (c *Client) Send(ctx context.Context, msg Message) error {
	if !c.Enabled() {
		return nil
	}
	full, err := BuildURL(c.BaseURL, msg.Title, msg.Content)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, full, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", httpUserAgent)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("notify: unexpected status %d body=%s", resp.StatusCode, truncateRunes(string(raw), 180))
	}
	return nil
}

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	if max <= 1 {
		return string(runes[:max])
	}
	return string(runes[:max-1]) + "…"
}

// StripMarkdownLight removes the noisiest markdown so WeChat text stays readable.
func StripMarkdownLight(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "__", "")
	s = strings.ReplaceAll(s, "```", "")
	s = strings.ReplaceAll(s, "`", "")
	// Collapse excessive blank lines.
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(s)
}
