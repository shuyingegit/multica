package main

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/notify"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// registerTaskNotifyListeners wires outbound task-end alerts.
//
// Design (SCS fork — away-from-desk awareness):
//   - Trigger ONLY on task:completed / task:failed (not every comment, not
//     progress_update chatter). Intermediate agent turns stay quiet.
//   - Skip chat-session tasks and auto-retry failures (retry_pending).
//   - Destinations come from workspace.settings.task_notify (Settings →
//     Integrations → 任务结束推送). Operators enable WeChat URL and/or
//     ClawBot per workspace.
//   - Legacy MULTICA_TASK_NOTIFY_URL still works as a fallback when the
//     workspace has not configured wechat_url yet.
func registerTaskNotifyListeners(bus *events.Bus, queries *db.Queries, envFallbackURL, appBaseURL string) {
	if bus == nil || queries == nil {
		return
	}
	appBaseURL = strings.TrimRight(strings.TrimSpace(appBaseURL), "/")
	envFallbackURL = strings.TrimSpace(envFallbackURL)

	bus.Subscribe(protocol.EventTaskCompleted, func(e events.Event) {
		go handleTaskNotify(context.Background(), queries, envFallbackURL, appBaseURL, e, "completed")
	})
	bus.Subscribe(protocol.EventTaskFailed, func(e events.Event) {
		go handleTaskNotify(context.Background(), queries, envFallbackURL, appBaseURL, e, "failed")
	})
	if envFallbackURL != "" {
		slog.Info("task notify listener registered", "legacy_env", redactNotifyHost(envFallbackURL))
	} else {
		slog.Info("task notify listener registered", "legacy_env", "(none — use workspace settings)")
	}
}

func handleTaskNotify(
	ctx context.Context,
	queries *db.Queries,
	envFallbackURL string,
	appBaseURL string,
	e events.Event,
	kind string,
) {
	payload, ok := e.Payload.(map[string]any)
	if !ok {
		return
	}

	issueID, _ := payload["issue_id"].(string)
	if issueID == "" || issueID == "00000000-0000-0000-0000-000000000000" {
		// Chat / autopilot-only runs — not the "which ticket finished" signal.
		return
	}
	if chatID, _ := payload["chat_session_id"].(string); chatID != "" {
		return
	}
	if kind == "failed" {
		if pending, _ := payload["retry_pending"].(bool); pending {
			return
		}
	}

	taskID, _ := payload["task_id"].(string)
	agentID, _ := payload["agent_id"].(string)

	issue, err := queries.GetIssue(ctx, parseUUID(issueID))
	if err != nil {
		slog.Warn("task notify: get issue failed", "issue_id", issueID, "error", err)
		return
	}
	ws, err := queries.GetWorkspace(ctx, issue.WorkspaceID)
	if err != nil {
		slog.Warn("task notify: get workspace failed", "error", err)
		return
	}

	channels := notify.ActiveChannels(notify.ParseConfig(ws.Settings, envFallbackURL))
	if len(channels) == 0 {
		return
	}

	identifier := service.IssueIdentifier(ws.IssuePrefix, issue.Number)
	agentName := lookupAgentName(ctx, queries, agentID)

	var title, content string
	switch kind {
	case "completed":
		title = identifier + " ✓ 完成"
		snippet := latestAgentReplySnippet(ctx, queries, issue, taskID)
		content = buildCompletedContent(issue.Title, agentName, snippet, appBaseURL, ws.Slug, identifier)
	default:
		title = identifier + " ✗ 失败"
		errText, _ := payload["error"].(string)
		if errText == "" {
			errText, _ = payload["failure_reason"].(string)
		}
		content = buildFailedContent(issue.Title, agentName, errText, appBaseURL, ws.Slug, identifier)
	}

	msg := notify.Message{Title: title, Content: content}
	sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for _, ch := range channels {
		if err := ch.Send(sendCtx, msg); err != nil {
			slog.Warn("task notify: send failed",
				"issue", identifier, "kind", kind, "channel", ch.Name(), "error", err)
			continue
		}
		slog.Info("task notify: sent", "issue", identifier, "kind", kind, "channel", ch.Name())
	}
}

func lookupAgentName(ctx context.Context, queries *db.Queries, agentID string) string {
	if agentID == "" {
		return "Agent"
	}
	agent, err := queries.GetAgent(ctx, parseUUID(agentID))
	if err != nil || agent.Name == "" {
		return "Agent"
	}
	return agent.Name
}

func latestAgentReplySnippet(ctx context.Context, queries *db.Queries, issue db.Issue, taskID string) string {
	comments, err := queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		Limit:       40,
	})
	if err != nil || len(comments) == 0 {
		return ""
	}
	taskUUID := parseUUID(taskID)
	// Prefer the newest agent comment tied to this task; fall back to any
	// recent non-progress agent comment.
	var fallback string
	for i := len(comments) - 1; i >= 0; i-- {
		c := comments[i]
		if c.AuthorType != "agent" {
			continue
		}
		if c.Type == "progress_update" || c.Type == "system" {
			continue
		}
		if c.DeletedAt.Valid {
			continue
		}
		text := notify.StripMarkdownLight(c.Content)
		if text == "" {
			continue
		}
		if taskUUID.Valid && c.SourceTaskID.Valid && util.UUIDToString(c.SourceTaskID) == taskID {
			return text
		}
		if fallback == "" {
			fallback = text
		}
	}
	return fallback
}

func buildCompletedContent(title, agentName, snippet, appBase, slug, identifier string) string {
	var b strings.Builder
	b.WriteString(title)
	if agentName != "" {
		b.WriteString("\n")
		b.WriteString(agentName)
		b.WriteString(" 已回复")
	}
	if snippet != "" {
		b.WriteString("\n\n")
		b.WriteString(snippet)
	}
	if link := issueDeepLink(appBase, slug, identifier); link != "" {
		b.WriteString("\n\n")
		b.WriteString(link)
	}
	return b.String()
}

func buildFailedContent(title, agentName, errText, appBase, slug, identifier string) string {
	var b strings.Builder
	b.WriteString(title)
	if agentName != "" {
		b.WriteString("\n")
		b.WriteString(agentName)
		b.WriteString(" 运行失败")
	}
	if errText != "" {
		b.WriteString("\n\n")
		b.WriteString(notify.StripMarkdownLight(errText))
	}
	if link := issueDeepLink(appBase, slug, identifier); link != "" {
		b.WriteString("\n\n")
		b.WriteString(link)
	}
	return b.String()
}

func issueDeepLink(appBase, slug, identifier string) string {
	appBase = strings.TrimRight(strings.TrimSpace(appBase), "/")
	slug = strings.Trim(strings.TrimSpace(slug), "/")
	identifier = strings.TrimSpace(identifier)
	if appBase == "" || slug == "" || identifier == "" {
		return ""
	}
	return appBase + "/" + slug + "/issues/" + identifier
}

func redactNotifyHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "(disabled)"
	}
	// Avoid logging full query-capable URLs; host+path is enough for ops.
	if i := strings.Index(raw, "://"); i >= 0 {
		rest := raw[i+3:]
		if slash := strings.IndexByte(rest, '/'); slash >= 0 {
			return raw[:i+3] + rest[:slash] + "/…"
		}
		return raw[:i+3] + rest
	}
	return "(set)"
}
