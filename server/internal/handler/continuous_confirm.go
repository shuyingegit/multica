package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
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
	commentContent string,
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
		Rounds:     prev.Rounds, // keep progress when merging into an active plan
		AgentID:    agentID,
		Max:        service.ContinuousConfirmDefaultMax,
		MaxSet:     true,
		Prompt:     prev.Prompt,
		DoneMarker: prev.DoneMarker,
		Brief:      prev.Brief,
	}
	if !prev.Enabled {
		plan.Rounds = 0
	}
	incomingMaxSet := payload.Max != nil
	switch {
	case prev.Enabled && prev.MaxSet:
		// Active plan: max only rises.
		incoming := 0
		if incomingMaxSet {
			incoming = *payload.Max
		}
		plan.Max = service.MergeContinuousConfirmMax(prev.EffectiveMax(), incoming, incomingMaxSet)
	case incomingMaxSet:
		plan.Max = service.ClampContinuousConfirmMax(*payload.Max)
	case prev.MaxSet:
		plan.Max = prev.EffectiveMax()
	default:
		plan.Max = service.ContinuousConfirmDefaultMax
	}
	if payload.Prompt != nil {
		nextPrompt := strings.TrimSpace(*payload.Prompt)
		// Only replace the template when the user explicitly customized it
		// (not the stock default). Otherwise keep the previous / default
		// template and fold new text into the brief instead.
		if nextPrompt != "" && nextPrompt != service.ContinuousConfirmDefaultPrompt {
			plan.Prompt = nextPrompt
		}
	}
	if payload.DoneMarker != nil {
		if dm := strings.TrimSpace(*payload.DoneMarker); dm != "" {
			plan.DoneMarker = dm
		}
	}
	if plan.Prompt == "" {
		plan.Prompt = service.ContinuousConfirmDefaultPrompt
	}
	if plan.DoneMarker == "" {
		plan.DoneMarker = service.ContinuousConfirmDefaultDoneMarker
	}
	plan.Brief = service.MergeContinuousConfirmBrief(plan.Brief, commentContent)

	// Premature done/cancelled must not strand the plan: reopen so the next
	// completion path can actually enqueue (SCS-298).
	if issue.Status == "done" || issue.Status == "cancelled" {
		issue = h.reopenIssueForContinuousConfirm(ctx, issue,
			fmt.Sprintf("已开启续跑计划，票从 %s 改回 in_progress。", issue.Status))
	}

	h.setContinuousConfirmMeta(ctx, issue, plan)
	slog.Info("continuous confirm: enabled/merged",
		"issue_id", uuidToString(issue.ID), "agent_id", agentID,
		"max", plan.EffectiveMax(), "rounds", plan.Rounds,
		"brief_len", len(plan.Brief))
	return agentID
}

// reopenIssueForContinuousConfirm moves done/cancelled → in_progress so the
// outer loop can actually keep running. Returns the refreshed issue row.
func (h *Handler) reopenIssueForContinuousConfirm(ctx context.Context, issue db.Issue, reason string) db.Issue {
	if issue.Status != "done" && issue.Status != "cancelled" {
		return issue
	}
	prev := issue.Status
	updated, err := h.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:          issue.ID,
		Status:      "in_progress",
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		slog.Warn("continuous confirm: reopen status failed",
			"issue_id", uuidToString(issue.ID), "from", prev, "error", err)
		return issue
	}
	prefix := h.getIssuePrefix(ctx, updated.WorkspaceID)
	resp := issueToResponse(updated, prefix)
	h.fillStatusCategory(ctx, updated.WorkspaceID, &resp)
	h.publish(protocol.EventIssueUpdated, uuidToString(updated.WorkspaceID), "system", "", map[string]any{
		"issue":          resp,
		"status_changed": true,
		"prev_status":    prev,
		"source":         "continuous_confirm",
	})
	msg := reason
	if strings.TrimSpace(msg) == "" {
		msg = fmt.Sprintf("票此前为 %s，续跑计划仍有效且未检测到结束标记，已自动改回 in_progress。", prev)
	}
	h.postContinuousConfirmSystemComment(ctx, updated, "【连续确认】"+msg)
	return updated
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
		service.ContinuousConfirmBriefMetaKey:      plan.Brief,
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
		service.ContinuousConfirmBriefMetaKey,
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
		prevRounds := plan.Rounds
		agentID := h.enableContinuousConfirm(ctx, fresh, outcomes, triggeredAgentIDs, plan.AgentID, payload, comment.Content)
		if agentID == "" {
			return
		}
		// Re-read after merge so resume keeps the preserved round budget.
		if refreshed, err := h.Queries.GetIssue(ctx, fresh.ID); err == nil {
			fresh = refreshed
			plan = service.ParseContinuousConfirmMeta(fresh.Metadata)
			prevRounds = plan.Rounds
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
				h.resumeContinuousConfirm(ctx, fresh, agentID, prevRounds)
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
		// Fold ordinary supplements into the living plan brief so follow-ups
		// don't get ignored by the outer loop.
		if merged := service.MergeContinuousConfirmBrief(plan.Brief, comment.Content); merged != plan.Brief {
			plan.Brief = merged
			h.setContinuousConfirmMeta(ctx, fresh, plan)
		}
		// Heal stalled plans: enabled, no active task (missed completion hook,
		// premature done hard-stop on older builds, etc.).
		if !h.issueHasActiveAgentTask(ctx, fresh.ID, pgtype.UUID{}) {
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

	agentText := h.continuousConfirmAgentText(ctx, issue, agentID, task)
	doneMarker := plan.EffectiveDoneMarker()

	// cancelled → always stop. done without DONE marker → reopen (premature
	// close). done with marker → stop. This fixes SCS-298 where the agent
	// kept marking the ticket done while the UI still said「续跑进行中」.
	if issue.Status == "cancelled" {
		h.disableContinuousConfirm(ctx, issue)
		h.postContinuousConfirmSystemComment(ctx, issue, "【连续确认】票已取消，续跑计划已停止。")
		return
	}
	if issue.Status == "done" {
		if service.ContinuousConfirmHasDoneMarker(agentText, doneMarker) {
			h.disableContinuousConfirm(ctx, issue)
			h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmStoppedDoneContent(doneMarker))
			return
		}
		issue = h.reopenIssueForContinuousConfirm(ctx, issue, "")
	} else if service.ContinuousConfirmHasDoneMarker(agentText, doneMarker) {
		h.disableContinuousConfirm(ctx, issue)
		h.postContinuousConfirmSystemComment(ctx, issue, service.ContinuousConfirmStoppedDoneContent(doneMarker))
		return
	}

	if h.issueHasActiveAgentTask(ctx, issue.ID, task.ID) {
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

type continuousConfirmPlanResponse struct {
	Enabled    bool   `json:"enabled"`
	Waiting    bool   `json:"waiting"`
	Rounds     int    `json:"rounds"`
	Max        int    `json:"max"`
	Prompt     string `json:"prompt"`
	DoneMarker string `json:"done_marker"`
	Brief      string `json:"brief"`
	AgentID    string `json:"agent_id,omitempty"`
}

func continuousConfirmPlanToResponse(p service.ContinuousConfirmPlan) continuousConfirmPlanResponse {
	return continuousConfirmPlanResponse{
		Enabled:    p.Enabled,
		Waiting:    p.Waiting,
		Rounds:     p.Rounds,
		Max:        p.EffectiveMax(),
		Prompt:     p.EffectivePrompt(),
		DoneMarker: p.EffectiveDoneMarker(),
		Brief:      p.Brief,
		AgentID:    p.AgentID,
	}
}

// GetContinuousConfirmPlan returns the living outer-loop plan (SCS fork).
func (h *Handler) GetContinuousConfirmPlan(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	writeJSON(w, http.StatusOK, continuousConfirmPlanToResponse(plan))
}

type updateContinuousConfirmPlanRequest struct {
	Max        *int    `json:"max"`
	Prompt     *string `json:"prompt"`
	DoneMarker *string `json:"done_marker"`
	Brief      *string `json:"brief"`
	Enabled    *bool   `json:"enabled"`
}

// UpdateContinuousConfirmPlan lets the user edit max/prompt/brief live.
// Max never decreases below the current plan max while the plan is active.
func (h *Handler) UpdateContinuousConfirmPlan(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	var req updateContinuousConfirmPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	if req.Enabled != nil && !*req.Enabled {
		h.disableContinuousConfirm(r.Context(), issue)
		writeJSON(w, http.StatusOK, continuousConfirmPlanToResponse(service.ContinuousConfirmPlan{}))
		return
	}
	if !plan.Enabled && (req.Enabled == nil || !*req.Enabled) {
		writeError(w, http.StatusConflict, "continuous confirm plan is not active")
		return
	}
	plan.Enabled = true
	if req.Max != nil {
		plan.Max = service.MergeContinuousConfirmMax(plan.EffectiveMax(), *req.Max, true)
		plan.MaxSet = true
	}
	if req.Prompt != nil {
		plan.Prompt = strings.TrimSpace(*req.Prompt)
		if plan.Prompt == "" {
			plan.Prompt = service.ContinuousConfirmDefaultPrompt
		}
	}
	if req.DoneMarker != nil {
		plan.DoneMarker = strings.TrimSpace(*req.DoneMarker)
		if plan.DoneMarker == "" {
			plan.DoneMarker = service.ContinuousConfirmDefaultDoneMarker
		}
	}
	if req.Brief != nil {
		plan.Brief = strings.TrimSpace(*req.Brief)
	}
	if issue.Status == "done" || issue.Status == "cancelled" {
		issue = h.reopenIssueForContinuousConfirm(r.Context(), issue, "")
	}
	h.setContinuousConfirmMeta(r.Context(), issue, plan)
	fresh, _ := h.Queries.GetIssue(r.Context(), issue.ID)
	writeJSON(w, http.StatusOK, continuousConfirmPlanToResponse(service.ParseContinuousConfirmMeta(fresh.Metadata)))
}

// FireContinuousConfirmPlan immediately steers a running turn or enqueues a round.
func (h *Handler) FireContinuousConfirmPlan(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	plan := service.ParseContinuousConfirmMeta(issue.Metadata)
	if !plan.Enabled {
		writeError(w, http.StatusConflict, "continuous confirm plan is not active")
		return
	}
	if plan.AgentID == "" {
		writeError(w, http.StatusConflict, "continuous confirm has no agent")
		return
	}
	if issue.Status == "done" || issue.Status == "cancelled" {
		issue = h.reopenIssueForContinuousConfirm(r.Context(), issue, "")
	}
	if refreshed, err := h.Queries.GetIssue(r.Context(), issue.ID); err == nil {
		issue = refreshed
		plan = service.ParseContinuousConfirmMeta(issue.Metadata)
	}
	if plan.AgentID == "" {
		writeError(w, http.StatusConflict, "continuous confirm has no agent")
		return
	}
	plan.Enabled = true
	plan.Waiting = false
	h.setContinuousConfirmMeta(r.Context(), issue, plan)

	note := service.ContinuousConfirmHandoffNote(plan) + "\n\n【立即触发】用户要求立刻按当前续跑计划推进。"

	active, err := h.Queries.ListActiveTasksByIssue(r.Context(), issue.ID)
	if err == nil {
		for _, task := range active {
			if !task.AgentID.Valid || uuidToString(task.AgentID) != plan.AgentID {
				continue
			}
			if task.Status != "running" {
				continue
			}
			authorUUID, perr := parseUUIDString(userID)
			if perr != nil || !authorUUID.Valid {
				break
			}
			reqID := dbid.NewV7()
			_, serr := h.Queries.CreateTaskSupplement(r.Context(), db.CreateTaskSupplementParams{
				TaskID:          task.ID,
				IssueID:         issue.ID,
				WorkspaceID:     issue.WorkspaceID,
				AuthorID:        authorUUID,
				Content:         note,
				ClientRequestID: reqID,
			})
			if serr == nil {
				h.notifyTaskSupplementAvailable(task)
				h.postContinuousConfirmSystemComment(r.Context(), issue, "【连续确认】已立即触发：插入当前正在运行的会话。")
				writeJSON(w, http.StatusOK, map[string]any{
					"ok":   true,
					"mode": "steered",
					"plan": continuousConfirmPlanToResponse(plan),
				})
				return
			}
			slog.Warn("continuous confirm: fire steer failed, falling back to enqueue",
				"issue_id", issueID, "error", serr)
			break
		}
	}

	if h.issueHasActiveAgentTask(r.Context(), issue.ID, pgtype.UUID{}) {
		// Another task is queued/dispatched — don't double-enqueue; just clear waiting.
		h.postContinuousConfirmSystemComment(r.Context(), issue, "【连续确认】当前已有任务在队列中，立即触发已记录到续跑计划，将在本轮结束后继续。")
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"mode": "deferred",
			"plan": continuousConfirmPlanToResponse(plan),
		})
		return
	}

	h.resumeContinuousConfirm(r.Context(), issue, plan.AgentID, plan.Rounds)
	h.postContinuousConfirmSystemComment(r.Context(), issue, "【连续确认】已立即触发：新开一轮续跑。")
	fresh, _ := h.Queries.GetIssue(r.Context(), issue.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"mode": "enqueued",
		"plan": continuousConfirmPlanToResponse(service.ParseContinuousConfirmMeta(fresh.Metadata)),
	})
}

// StopContinuousConfirmPlan clears the living plan.
func (h *Handler) StopContinuousConfirmPlan(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	h.disableContinuousConfirm(r.Context(), issue)
	h.postContinuousConfirmSystemComment(r.Context(), issue, "【连续确认】已按你的指示结束自动续跑。")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
