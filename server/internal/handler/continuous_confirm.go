package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	dbid "github.com/multica-ai/multica/server/pkg/dbid"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ContinuousConfirmPayload is accepted on create-comment as either a bool
// (legacy) or an object: {"enabled":true,"max":20,"prompt":"...","done_marker":"..."}.
type ContinuousConfirmPayload struct {
	Set        bool
	Enabled    bool
	Max        *int
	Prompt     *string
	DoneMarker *string
}

func parseContinuousConfirmPayload(raw json.RawMessage) (ContinuousConfirmPayload, error) {
	var out ContinuousConfirmPayload
	if len(raw) == 0 || string(raw) == "null" {
		return out, nil
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		out.Set = true
		out.Enabled = b
		return out, nil
	}
	var obj struct {
		Enabled    *bool   `json:"enabled"`
		Max        *int    `json:"max"`
		Prompt     *string `json:"prompt"`
		DoneMarker *string `json:"done_marker"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return out, fmt.Errorf("continuous_confirm must be bool or object")
	}
	out.Set = true
	if obj.Enabled != nil {
		out.Enabled = *obj.Enabled
	} else {
		// Object without enabled defaults to on (sending a plan implies enable).
		out.Enabled = true
	}
	out.Max = obj.Max
	out.Prompt = obj.Prompt
	out.DoneMarker = obj.DoneMarker
	return out, nil
}

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
	payload ContinuousConfirmPayload,
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

	prev := service.ParseContinuousConfirmMeta(issue.Metadata)
	plan := service.ContinuousConfirmPlan{
		Enabled:    true,
		Waiting:    false,
		Rounds:     0,
		AgentID:    agentID,
		Max:        service.ContinuousConfirmDefaultMax,
		MaxSet:     true,
		Prompt:     prev.Prompt,
		DoneMarker: prev.DoneMarker,
	}
	if payload.Max != nil {
		plan.Max = service.ClampContinuousConfirmMax(*payload.Max)
	} else if prev.MaxSet {
		plan.Max = prev.EffectiveMax()
	}
	if payload.Prompt != nil {
		plan.Prompt = strings.TrimSpace(*payload.Prompt)
	}
	if payload.DoneMarker != nil {
		plan.DoneMarker = strings.TrimSpace(*payload.DoneMarker)
	}
	if plan.Prompt == "" {
		plan.Prompt = service.ContinuousConfirmDefaultPrompt
	}
	if plan.DoneMarker == "" {
		plan.DoneMarker = service.ContinuousConfirmDefaultDoneMarker
	}

	h.setContinuousConfirmMeta(ctx, issue, plan)
	slog.Info("continuous confirm: enabled",
		"issue_id", uuidToString(issue.ID), "agent_id", agentID,
		"max", plan.EffectiveMax())
	return agentID
}

func (h *Handler) disableContinuousConfirm(ctx context.Context, issue db.Issue) {
	h.clearContinuousConfirmMeta(ctx, issue)
}

func (h *Handler) setContinuousConfirmMeta(ctx context.Context, issue db.Issue, plan service.ContinuousConfirmPlan) {
	keys := map[string]any{
		service.ContinuousConfirmMetaKey:           plan.Enabled,
		service.ContinuousConfirmWaitingMetaKey:    plan.Waiting,
		service.ContinuousConfirmRoundsMetaKey:     plan.Rounds,
		service.ContinuousConfirmAgentMetaKey:      plan.AgentID,
		service.ContinuousConfirmMaxMetaKey:        plan.EffectiveMax(),
		service.ContinuousConfirmPromptMetaKey:     plan.EffectivePrompt(),
		service.ContinuousConfirmDoneMarkerMetaKey: plan.EffectiveDoneMarker(),
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
		service.ContinuousConfirmMaxMetaKey,
		service.ContinuousConfirmPromptMetaKey,
		service.ContinuousConfirmDoneMarkerMetaKey,
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
	payload ContinuousConfirmPayload,
	outcomes []CommentTriggerOutcome,
	triggeredAgentIDs []string,
) {
	fresh, err := h.Queries.GetIssue(ctx, issue.ID)
	if err != nil {
		return
	}
	plan := service.ParseContinuousConfirmMeta(fresh.Metadata)

	if payload.Set && !payload.Enabled {
		h.disableContinuousConfirm(ctx, fresh)
		return
	}

	if payload.Set && payload.Enabled {
		wasWaiting := plan.Waiting
		agentID := h.enableContinuousConfirm(ctx, fresh, outcomes, triggeredAgentIDs, plan.AgentID, payload)
		if agentID == "" {
			return
		}
		// If we were waiting on the user, or this comment didn't start any
		// agent run, kick a follow-up so enabling the plan always continues.
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

	if !plan.Enabled {
		return
	}

	switch service.ContinuousConfirmUserIntent(comment.Content) {
	case "continue":
		if !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
			h.resumeContinuousConfirm(ctx, fresh, plan.AgentID, plan.Rounds)
		} else {
			plan.Waiting = false
			h.setContinuousConfirmMeta(ctx, fresh, plan)
		}
	case "stop":
		h.disableContinuousConfirm(ctx, fresh)
		h.postContinuousConfirmSystemComment(ctx, fresh, "【连续确认】已按你的指示结束自动续跑。")
	default:
		if plan.Waiting && !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
			h.resumeContinuousConfirm(ctx, fresh, plan.AgentID, plan.Rounds)
		}
	}
}

func (h *Handler) resumeContinuousConfirm(ctx context.Context, issue db.Issue, agentID string, rounds int) {
	if agentID == "" {
		return
	}
	fresh, err := h.Queries.GetIssue(ctx, issue.ID)
	if err == nil {
		issue = fresh
	}
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	plan.Enabled = true
	plan.Waiting = false
	plan.Rounds = rounds
	plan.AgentID = agentID
	h.setContinuousConfirmMeta(ctx, issue, plan)
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
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	if !plan.Enabled || plan.Waiting {
		return
	}
	agentID := plan.AgentID
	if agentID == "" {
		agentID = uuidToString(task.AgentID)
	}

	if service.ContinuousConfirmHardStopStatus(issue.Status) {
		h.disableContinuousConfirm(ctx, issue)
		return
	}

	if h.issueHasActiveAgentTask(ctx, issue.ID, task.ID) {
		return
	}

	agentText := h.continuousConfirmAgentText(ctx, issue, agentID, task)
	doneMarker := plan.EffectiveDoneMarker()
	if service.ContinuousConfirmHasDoneMarker(agentText, doneMarker) {
		h.disableContinuousConfirm(ctx, issue)
		h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmStoppedDoneContent(doneMarker))
		return
	}

	if terminal == "failed" || issue.Status == "blocked" || service.ContinuousConfirmNeedsIntervention(agentText) {
		h.askContinuousConfirmUser(ctx, issue, agentID, plan.Rounds,
			"智能体本轮失败、已 blocked，或明确需要用户介入")
		return
	}

	max := plan.EffectiveMax()
	next := plan.Rounds + 1
	if next > max {
		h.disableContinuousConfirm(ctx, issue)
		h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmStoppedMaxContent(max))
		return
	}

	h.enqueueContinuousConfirmRound(ctx, issue, agentID, next)
}

func (h *Handler) continuousConfirmAgentText(ctx context.Context, issue db.Issue, agentID string, task *db.AgentTaskQueue) string {
	var parts []string
	if task != nil && len(task.Result) > 0 {
		var req struct {
			Output string `json:"output"`
		}
		if json.Unmarshal(task.Result, &req) == nil && strings.TrimSpace(req.Output) != "" {
			parts = append(parts, req.Output)
		}
	}
	comments, err := h.Queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		Limit:       12,
	})
	if err == nil {
		for i := len(comments) - 1; i >= 0; i-- {
			c := comments[i]
			if c.AuthorType != "agent" {
				continue
			}
			if agentID != "" && c.AuthorID.Valid && uuidToString(c.AuthorID) != agentID {
				continue
			}
			parts = append(parts, c.Content)
			break
		}
	}
	return strings.Join(parts, "\n")
}

func (h *Handler) askContinuousConfirmUser(ctx context.Context, issue db.Issue, agentID string, rounds int, reason string) {
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	plan.Enabled = true
	plan.Waiting = true
	plan.Rounds = rounds
	if agentID != "" {
		plan.AgentID = agentID
	}
	h.setContinuousConfirmMeta(ctx, issue, plan)
	h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmAskUserContent(reason))
}

func (h *Handler) enqueueContinuousConfirmRound(ctx context.Context, issue db.Issue, agentID string, round int) {
	agentUUID, err := parseUUIDString(agentID)
	if err != nil || !agentUUID.Valid {
		return
	}
	if fresh, err := h.Queries.GetIssue(ctx, issue.ID); err == nil {
		issue = fresh
	}
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	plan.Enabled = true
	plan.Waiting = false
	plan.Rounds = round
	plan.AgentID = agentID
	max := plan.EffectiveMax()
	h.setContinuousConfirmMeta(ctx, issue, plan)
	h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmProgressContent(round, max))

	note := service.ContinuousConfirmHandoffNote(plan)
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
	plan := service.ParseContinuousConfirmMeta(issueMetadata)
	if !plan.Enabled || plan.Waiting {
		return
	}
	note := service.ContinuousConfirmHandoffNote(plan)
	if resp.HandoffNote == "" {
		resp.HandoffNote = note
	} else {
		resp.HandoffNote = resp.HandoffNote + "\n\n" + note
	}
}
