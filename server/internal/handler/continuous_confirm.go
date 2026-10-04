package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	dbid "github.com/multica-ai/multica/server/pkg/dbid"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// enableContinuousConfirm stamps issue metadata and picks the agent to keep
// waking. Prefer agents that actually received work from this comment
// (including reply/assignee routes that never appear in mention outcomes),
// then mention outcomes, then a previously stored agent, then assignee.
func (h *Handler) enableContinuousConfirm(
	ctx context.Context,
	issue db.Issue,
	outcomes []CommentTriggerOutcome,
	triggeredAgentIDs []string,
	fallbackAgentID string,
) string {
	agentID := ""
	if len(triggeredAgentIDs) > 0 {
		agentID = triggeredAgentIDs[0]
	}
	if agentID == "" {
		for _, o := range outcomes {
			if o.TargetType != "agent" || o.TargetID == "" {
				continue
			}
			switch o.Status {
			case DispatchQueued, DispatchCoalesced, DispatchDeferred, DispatchSteered:
				agentID = o.TargetID
			default:
				continue
			}
			break
		}
	}
	if agentID == "" {
		agentID = fallbackAgentID
	}
	if agentID == "" && issue.AssigneeType.Valid && issue.AssigneeType.String == "agent" && issue.AssigneeID.Valid {
		agentID = uuidToString(issue.AssigneeID)
	}
	if agentID == "" {
		slog.Warn("continuous confirm: enabled but no agent resolved",
			"issue_id", uuidToString(issue.ID))
		return ""
	}
	// Fresh human kickoff: reset round budget so long tickets (SCS-298) get a
	// new window of auto-continues after the user re-engages.
	h.setContinuousConfirmMeta(ctx, issue, true, false, 0, agentID)
	slog.Info("continuous confirm: enabled",
		"issue_id", uuidToString(issue.ID), "agent_id", agentID)
	return agentID
}

func (h *Handler) disableContinuousConfirm(ctx context.Context, issue db.Issue) {
	h.clearContinuousConfirmMeta(ctx, issue)
}

func (h *Handler) setContinuousConfirmMeta(
	ctx context.Context,
	issue db.Issue,
	enabled, waiting bool,
	rounds int,
	agentID string,
) {
	keys := map[string]any{
		service.ContinuousConfirmMetaKey:        enabled,
		service.ContinuousConfirmWaitingMetaKey: waiting,
		service.ContinuousConfirmRoundsMetaKey:  rounds,
		service.ContinuousConfirmAgentMetaKey:   agentID,
	}
	for k, v := range keys {
		raw, err := json.Marshal(v)
		if err != nil {
			continue
		}
		if _, err := h.Queries.SetIssueMetadataKey(ctx, db.SetIssueMetadataKeyParams{
			ID:          issue.ID,
			WorkspaceID: issue.WorkspaceID,
			Key:         k,
			Value:       raw,
		}); err != nil {
			slog.Warn("continuous confirm: set metadata failed",
				"issue_id", uuidToString(issue.ID), "key", k, "error", err)
		}
	}
}

func (h *Handler) clearContinuousConfirmMeta(ctx context.Context, issue db.Issue) {
	for _, k := range []string{
		service.ContinuousConfirmMetaKey,
		service.ContinuousConfirmWaitingMetaKey,
		service.ContinuousConfirmRoundsMetaKey,
		service.ContinuousConfirmAgentMetaKey,
	} {
		if _, err := h.Queries.DeleteIssueMetadataKey(ctx, db.DeleteIssueMetadataKeyParams{
			ID:          issue.ID,
			WorkspaceID: issue.WorkspaceID,
			Key:         k,
		}); err != nil {
			slog.Debug("continuous confirm: delete metadata",
				"issue_id", uuidToString(issue.ID), "key", k, "error", err)
		}
	}
}

func (h *Handler) issueHasActiveAgentTask(ctx context.Context, issueID pgtype.UUID, ignoreTaskID pgtype.UUID) bool {
	active, err := h.Queries.ListActiveTasksByIssue(ctx, issueID)
	if err != nil {
		return true // fail closed: don't double-enqueue on list errors
	}
	for _, a := range active {
		if ignoreTaskID.Valid && a.ID == ignoreTaskID {
			continue
		}
		return true
	}
	return false
}

// handleContinuousConfirmOnMemberComment runs after a member comment is saved.
func (h *Handler) handleContinuousConfirmOnMemberComment(
	ctx context.Context,
	issue db.Issue,
	comment db.Comment,
	continuousConfirm *bool,
	outcomes []CommentTriggerOutcome,
	triggeredAgentIDs []string,
) {
	fresh, err := h.Queries.GetIssue(ctx, issue.ID)
	if err != nil {
		return
	}
	enabled, waiting, rounds, agentID := service.ParseContinuousConfirmMeta(fresh.Metadata)

	if continuousConfirm != nil && !*continuousConfirm {
		h.disableContinuousConfirm(ctx, fresh)
		return
	}

	if continuousConfirm != nil && *continuousConfirm {
		wasWaiting := waiting
		agentID = h.enableContinuousConfirm(ctx, fresh, outcomes, triggeredAgentIDs, agentID)
		if agentID == "" {
			return
		}
		// If we were waiting on the user, or this comment didn't start any
		// agent run, kick a follow-up so "勾着连续确认发一句话" always continues.
		triggered := len(triggeredAgentIDs) > 0
		for _, o := range outcomes {
			switch o.Status {
			case DispatchQueued, DispatchCoalesced, DispatchDeferred, DispatchSteered:
				triggered = true
			}
		}
		if wasWaiting || !triggered {
			if !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
				h.resumeContinuousConfirm(ctx, fresh, agentID, 0)
			}
		}
		return
	}

	if !enabled {
		return
	}

	switch service.ContinuousConfirmUserIntent(comment.Content) {
	case "continue":
		if !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
			h.resumeContinuousConfirm(ctx, fresh, agentID, rounds)
		} else {
			// Clear waiting so the active/next completion path keeps auto-running.
			h.setContinuousConfirmMeta(ctx, fresh, true, false, rounds, agentID)
		}
	case "stop":
		h.disableContinuousConfirm(ctx, fresh)
		h.postContinuousConfirmSystemComment(ctx, fresh, "【连续确认】已按你的指示结束自动续跑。")
	default:
		// While waiting, any other member comment that still has the flag on
		// (checkbox omitted from older clients) should not leave the loop stuck:
		// if waiting, treat as soft continue when no agent is active.
		if waiting && !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
			h.resumeContinuousConfirm(ctx, fresh, agentID, rounds)
		}
	}
}

func (h *Handler) resumeContinuousConfirm(ctx context.Context, issue db.Issue, agentID string, rounds int) {
	if agentID == "" {
		return
	}
	h.setContinuousConfirmMeta(ctx, issue, true, false, rounds, agentID)
	h.enqueueContinuousConfirmRound(ctx, issue, agentID, rounds+1)
}

// maybeContinueContinuousConfirm runs after a task reaches a terminal status.
// Only when no other agent is still active on the issue do we intervene.
func (h *Handler) maybeContinueContinuousConfirm(ctx context.Context, task *db.AgentTaskQueue, terminal string) {
	if task == nil || !task.IssueID.Valid || !task.AgentID.Valid {
		return
	}
	issue, err := h.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return
	}
	enabled, waiting, rounds, agentID := service.ParseContinuousConfirmMeta(issue.Metadata)
	if !enabled || waiting {
		return
	}
	if agentID == "" {
		agentID = uuidToString(task.AgentID)
	}

	// Only thoroughly finished / cancelled tickets stop the loop.
	if service.ContinuousConfirmHardStopStatus(issue.Status) {
		h.disableContinuousConfirm(ctx, issue)
		return
	}

	if h.issueHasActiveAgentTask(ctx, issue.ID, task.ID) {
		return
	}

	if terminal == "failed" || issue.Status == "blocked" {
		h.askContinuousConfirmUser(ctx, issue, agentID, rounds,
			"智能体本轮失败或已 blocked，没有自动方案可继续")
		return
	}

	// in_review / in_progress / todo / … — keep going until done (SCS-298).
	next := rounds + 1
	if next > service.ContinuousConfirmMaxRounds {
		h.askContinuousConfirmUser(ctx, issue, agentID, rounds,
			fmt.Sprintf("已自动续跑 %d 轮仍未彻底完成", service.ContinuousConfirmMaxRounds))
		return
	}

	h.enqueueContinuousConfirmRound(ctx, issue, agentID, next)
}

func (h *Handler) askContinuousConfirmUser(ctx context.Context, issue db.Issue, agentID string, rounds int, reason string) {
	h.setContinuousConfirmMeta(ctx, issue, true, true, rounds, agentID)
	h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmAskUserContent(reason))
}

func (h *Handler) enqueueContinuousConfirmRound(ctx context.Context, issue db.Issue, agentID string, round int) {
	agentUUID, err := parseUUIDString(agentID)
	if err != nil || !agentUUID.Valid {
		return
	}
	h.setContinuousConfirmMeta(ctx, issue, true, false, round, agentID)
	h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmProgressContent(round, service.ContinuousConfirmMaxRounds))

	note := service.ContinuousConfirmHandoffNote(round, service.ContinuousConfirmMaxRounds)
	if _, err := h.TaskService.EnqueueTaskForAgentWithHandoff(ctx, issue, agentUUID, note, pgtype.UUID{}); err != nil {
		slog.Warn("continuous confirm: enqueue failed",
			"issue_id", uuidToString(issue.ID), "agent_id", agentID, "error", err)
		h.askContinuousConfirmUser(ctx, issue, agentID, round-1, "自动续跑排队失败，需要你介入")
	}
}

func (h *Handler) postContinuousConfirmSystemComment(ctx context.Context, issue db.Issue, content string) {
	created, err := h.Queries.CreateComment(ctx, db.CreateCommentParams{
		ID:          dbid.NewV7(),
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		AuthorType:  "system",
		AuthorID:    pgtype.UUID{Valid: true},
		Content:     content,
		Type:        "system",
	})
	if err != nil {
		slog.Warn("continuous confirm: system comment failed",
			"issue_id", uuidToString(issue.ID), "error", err)
		return
	}
	comment := created.Comment()
	h.publish(protocol.EventCommentCreated, uuidToString(issue.WorkspaceID), "system", "", map[string]any{
		"comment":      commentToResponse(comment, nil, nil),
		"issue_title":  issue.Title,
		"issue_status": issue.Status,
	})
}

func parseUUIDString(s string) (pgtype.UUID, error) {
	if s == "" {
		return pgtype.UUID{}, fmt.Errorf("empty uuid")
	}
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

// injectContinuousConfirmHandoff appends the keep-going brief onto the claim
// payload when the issue flag is on (works with existing daemon prompt code).
func injectContinuousConfirmHandoff(resp *AgentTaskResponse, issueMetadata []byte) {
	enabled, waiting, rounds, _ := service.ParseContinuousConfirmMeta(issueMetadata)
	if !enabled || waiting {
		return
	}
	note := service.ContinuousConfirmHandoffNote(rounds, service.ContinuousConfirmMaxRounds)
	if resp.HandoffNote == "" {
		resp.HandoffNote = note
	} else {
		resp.HandoffNote = resp.HandoffNote + "\n\n" + note
	}
}
