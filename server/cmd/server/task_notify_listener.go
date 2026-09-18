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

	cfg := notify.ParseConfig(ws.Settings, envFallbackURL)
	channels := notify.ActiveChannels(cfg)
	if len(channels) == 0 {
		return
	}
	resolvedBase := notify.ResolveAppBaseURL(cfg.AppBaseURL, appBaseURL)

	identifier := service.IssueIdentifier(ws.IssuePrefix, issue.Number)
	agentName := lookupAgentName(ctx, queries, agentID)

	// Title stays short (identifier + status + who). The gist lives in content.
	// A long Chinese title plus 【scsoi】 blows PushPlus's byte cap and the
	// send fails silently, which is what stopped ClawBot after the last update.
	var title, content string
	switch kind {
	case "completed":
		reply := latestAgentReply(ctx, queries, issue, taskID)
		title = notify.BuildTaskEndTitle(identifier, "completed", agentName, "", 16)
		content = notify.BuildTaskEndContent(
			"completed", issue.Title, agentName, reply.Snippet,
			resolvedBase, ws.Slug, identifier, reply.CommentID,
		)
	default:
		errText, _ := payload["error"].(string)
		if errText == "" {
			errText, _ = payload["failure_reason"].(string)
		}
		// Prefer anchoring on the newest agent/system note for this task when
		// present so the push opens at the failure message, not the issue top.
		reply := latestAgentReply(ctx, queries, issue, taskID)
		body := errText
		if reply.Snippet != "" {
			// Prefer the agent note gist when present; keep error as fallback.
			body = reply.Snippet
			if errText != "" && !strings.Contains(reply.Snippet, errText) {
				body = reply.Snippet + "\n" + errText
			}
		}
		title = notify.BuildTaskEndTitle(identifier, "failed", agentName, "", 16)
		content = notify.BuildTaskEndContent(
			"failed", issue.Title, agentName, body,
			resolvedBase, ws.Slug, identifier, reply.CommentID,
		)
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

type agentReplyAnchor struct {
	Snippet   string
	CommentID string
}

func latestAgentReply(ctx context.Context, queries *db.Queries, issue db.Issue, taskID string) agentReplyAnchor {
	comments, err := queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		Limit:       40,
	})
	if err != nil || len(comments) == 0 {
		return agentReplyAnchor{}
	}
	taskUUID := parseUUID(taskID)
	// Prefer the newest agent comment tied to this task; fall back to any
	// recent non-progress agent comment.
	var fallback agentReplyAnchor
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
		anchor := agentReplyAnchor{
			Snippet:   text,
			CommentID: util.UUIDToString(c.ID),
		}
		if taskUUID.Valid && c.SourceTaskID.Valid && util.UUIDToString(c.SourceTaskID) == taskID {
			return anchor
		}
		if fallback.CommentID == "" {
			fallback = anchor
		}
	}
	return fallback
}

// issueDeepLink builds a deep link into the issue page. When commentID is set,
// appends #comment-{id} so the web client scrolls/highlights that message
// (see packages/views/issues/components/issue-detail-route.tsx).
func issueDeepLink(appBase, slug, identifier, commentID string) string {
	return notify.JoinIssueDeepLink(appBase, slug, identifier, commentID)
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
