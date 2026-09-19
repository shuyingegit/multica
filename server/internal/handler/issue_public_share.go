package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/issueshare"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	guestCommentPrefix = "【外部访客】"
	shareAccessCookie  = "multica_issue_share"
	shareAccessTTL     = 7 * 24 * time.Hour
)

func shareTokenSecret() string {
	if s := strings.TrimSpace(os.Getenv("JWT_SECRET")); s != "" {
		return s
	}
	if s := strings.TrimSpace(os.Getenv("MULTICA_JWT_SECRET")); s != "" {
		return s
	}
	return "multica-fork-issue-share-dev"
}

type issuePublicShareResponse struct {
	Code      string `json:"code"`
	AuthMode  string `json:"auth_mode"`
	CutoffAt  string `json:"cutoff_at"`
	Path      string `json:"path"`
	IsActive  bool   `json:"is_active"`
	CreatedAt string `json:"created_at"`
}

type upsertIssuePublicShareRequest struct {
	AuthMode string `json:"auth_mode"`
	Password string `json:"password,omitempty"`
}

// GetIssuePublicShare — GET /api/issues/{id}/public-share
func (h *Handler) GetIssuePublicShare(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	share, err := issueshare.GetActiveByIssue(r.Context(), h.DB, uuid.MustParse(uuidToString(issue.ID)))
	if err != nil {
		slog.Warn("get issue public share failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to load share")
		return
	}
	if share == nil {
		writeJSON(w, http.StatusOK, map[string]any{"is_active": false})
		return
	}
	writeJSON(w, http.StatusOK, issuePublicShareResponse{
		Code:      share.Code,
		AuthMode:  share.AuthMode,
		CutoffAt:  share.CutoffAt.UTC().Format(time.RFC3339Nano),
		Path:      "/p/i/" + share.Code,
		IsActive:  true,
		CreatedAt: share.CreatedAt.UTC().Format(time.RFC3339Nano),
	})
}

// UpsertIssuePublicShare — POST /api/issues/{id}/public-share
func (h *Handler) UpsertIssuePublicShare(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	member, err := h.getWorkspaceMember(r.Context(), userID, uuidToString(issue.WorkspaceID))
	if err != nil || !roleAllowed(member.Role, "owner", "admin", "member") {
		writeError(w, http.StatusForbidden, "not a workspace member")
		return
	}

	var req upsertIssuePublicShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.AuthMode))
	if mode == "" {
		mode = "none"
	}
	if mode != "none" && mode != "password" {
		writeError(w, http.StatusBadRequest, "auth_mode must be none or password")
		return
	}
	password := strings.TrimSpace(req.Password)
	if mode == "password" && len(password) < 4 {
		writeError(w, http.StatusBadRequest, "password must be at least 4 characters")
		return
	}

	secret := shareTokenSecret()
	hash := ""
	if mode == "password" {
		hash = issueshare.HashPassword(secret, password)
	}

	issueUUID := uuid.MustParse(uuidToString(issue.ID))
	existing, err := issueshare.GetActiveByIssue(r.Context(), h.DB, issueUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load share")
		return
	}

	if existing != nil {
		nextHash := existing.PasswordHash
		if mode == "password" {
			if password != "" {
				nextHash = issueshare.HashPassword(secret, password)
			} else if existing.AuthMode != "password" || existing.PasswordHash == "" {
				writeError(w, http.StatusBadRequest, "password must be at least 4 characters")
				return
			}
		} else {
			nextHash = ""
		}
		if err := issueshare.UpdateAuth(r.Context(), h.DB, existing.ID, mode, nextHash); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update share")
			return
		}
		existing.AuthMode = mode
		writeJSON(w, http.StatusOK, issuePublicShareResponse{
			Code:      existing.Code,
			AuthMode:  mode,
			CutoffAt:  existing.CutoffAt.UTC().Format(time.RFC3339Nano),
			Path:      "/p/i/" + existing.Code,
			IsActive:  true,
			CreatedAt: existing.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
		return
	}

	code, err := issueshare.NewCode()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate code")
		return
	}
	now := time.Now().UTC()
	share := &issueshare.Share{
		ID:           uuid.MustParse(uuidToString(dbid.NewV7())),
		WorkspaceID:  uuid.MustParse(uuidToString(issue.WorkspaceID)),
		IssueID:      issueUUID,
		Code:         code,
		AuthMode:     mode,
		PasswordHash: hash,
		CutoffAt:     now,
		CreatedBy:    uuid.MustParse(userID),
		IsActive:     true,
		CreatedAt:    now,
	}
	if err := issueshare.Insert(r.Context(), h.DB, share); err != nil {
		slog.Warn("create issue public share failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create share")
		return
	}
	writeJSON(w, http.StatusCreated, issuePublicShareResponse{
		Code:      code,
		AuthMode:  mode,
		CutoffAt:  now.Format(time.RFC3339Nano),
		Path:      "/p/i/" + code,
		IsActive:  true,
		CreatedAt: now.Format(time.RFC3339Nano),
	})
}

// RevokeIssuePublicShare — DELETE /api/issues/{id}/public-share
func (h *Handler) RevokeIssuePublicShare(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if err := issueshare.RevokeActiveForIssue(r.Context(), h.DB, uuid.MustParse(uuidToString(issue.ID))); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke share")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetPublicIssueShareMeta — GET /api/public/issue-shares/{code}
func (h *Handler) GetPublicIssueShareMeta(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	share, issue, ws, ok := h.loadPublicIssueShare(w, r, code)
	if !ok {
		return
	}
	unlocked := share.AuthMode == "none" || h.publicShareUnlocked(r, share)
	identifier := service.IssueIdentifier(ws.IssuePrefix, issue.Number)
	assigneeName, assigneeType, assigneeID := h.publicShareAssignee(r, issue)
	writeJSON(w, http.StatusOK, map[string]any{
		"code":           share.Code,
		"auth_mode":      share.AuthMode,
		"needs_password": share.AuthMode == "password" && !unlocked,
		"title":          issue.Title,
		"identifier":     identifier,
		"cutoff_at":      share.CutoffAt.UTC().Format(time.RFC3339Nano),
		"assignee_name":  assigneeName,
		"assignee_type":  assigneeType,
		"assignee_id":    assigneeID,
		"unlocked":       unlocked,
	})
}

type unlockPublicShareRequest struct {
	Password string `json:"password"`
}

// UnlockPublicIssueShare — POST /api/public/issue-shares/{code}/unlock
func (h *Handler) UnlockPublicIssueShare(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	share, err := issueshare.GetActiveByCode(r.Context(), h.DB, code)
	if err != nil || share == nil {
		writeError(w, http.StatusNotFound, "share not found")
		return
	}
	if share.AuthMode != "password" {
		writeJSON(w, http.StatusOK, map[string]any{"unlocked": true})
		return
	}
	var req unlockPublicShareRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if !issueshare.CheckPassword(shareTokenSecret(), strings.TrimSpace(req.Password), share.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "incorrect password")
		return
	}
	token := issueshare.MintAccessToken(shareTokenSecret(), share.Code, shareAccessTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     shareAccessCookie + "_" + share.Code,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(shareAccessTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"unlocked": true, "token": token})
}

// ListPublicIssueShareTimeline — GET /api/public/issue-shares/{code}/timeline
func (h *Handler) ListPublicIssueShareTimeline(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	share, issue, _, ok := h.loadPublicIssueShare(w, r, code)
	if !ok {
		return
	}
	if !h.requirePublicShareAccess(w, r, share) {
		return
	}
	comments, err := issueshare.ListPublicComments(
		r.Context(), h.DB,
		uuid.MustParse(uuidToString(issue.ID)),
		uuid.MustParse(uuidToString(issue.WorkspaceID)),
		500,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load timeline")
		return
	}
	items := make([]map[string]any, 0, len(comments))
	for _, c := range comments {
		guestNick, guestLoc, isGuest := parseGuestMeta(c.Content)
		authorName, authorAvatar := h.publicShareAuthor(r, c.AuthorType, c.AuthorID.String(), guestNick, isGuest)
		items = append(items, map[string]any{
			"id":                c.ID.String(),
			"author_type":       c.AuthorType,
			"author_id":         c.AuthorID.String(),
			"author_name":       authorName,
			"author_avatar_url": authorAvatar,
			"content":           c.Content,
			"type":              c.Type,
			"created_at":        c.CreatedAt.UTC().Format(time.RFC3339Nano),
			"is_guest":          isGuest,
			"guest_nickname":    guestNick,
			"guest_location":    guestLoc,
		})
	}
	workRows, err := issueshare.ListOpenWork(r.Context(), h.DB, uuid.MustParse(uuidToString(issue.ID)))
	if err != nil {
		slog.Warn("public share work list failed", append(logger.RequestAttrs(r), "error", err)...)
		workRows = nil
	}
	work := make([]map[string]any, 0, len(workRows))
	for _, row := range workRows {
		work = append(work, map[string]any{
			"agent_id":     row.AgentID.String(),
			"agent_name":   row.AgentName,
			"status":       row.Status,
			"status_label": publicWorkStatusLabel(row.Status),
			"since":        row.Since.UTC().Format(time.RFC3339Nano),
		})
	}
	progressRows, err := issueshare.ListIssueProgress(r.Context(), h.DB, uuid.MustParse(uuidToString(issue.ID)))
	if err != nil {
		slog.Warn("public share progress list failed", append(logger.RequestAttrs(r), "error", err)...)
		progressRows = nil
	}
	progress := make([]map[string]any, 0, len(progressRows))
	for _, row := range progressRows {
		text := issueshare.PublicProgressText(row.Type, row.Tool, row.Content)
		if text == "" {
			continue
		}
		progress = append(progress, map[string]any{
			"id":         row.ID.String(),
			"agent_name": row.AgentName,
			"text":       text,
			"created_at": row.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": items, "work": work, "progress": progress})
}

type publicIssueCommentRequest struct {
	Content  string `json:"content"`
	Nickname string `json:"nickname,omitempty"`
	Location string `json:"location,omitempty"`
	ParentID string `json:"parent_id,omitempty"`
}

// CreatePublicIssueShareComment — POST /api/public/issue-shares/{code}/comments
func (h *Handler) CreatePublicIssueShareComment(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	share, issue, _, ok := h.loadPublicIssueShare(w, r, code)
	if !ok {
		return
	}
	if !h.requirePublicShareAccess(w, r, share) {
		return
	}
	var req publicIssueCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	content := sanitizeNullBytes(strings.TrimSpace(req.Content))
	if content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		writeError(w, http.StatusBadRequest, "nickname is required")
		return
	}
	location := strings.TrimSpace(req.Location)
	if location == "" {
		writeError(w, http.StatusBadRequest, "location is required")
		return
	}
	if !strings.HasPrefix(content, guestCommentPrefix) {
		content = formatGuestCommentBody(nickname, location, content)
	}

	var parent pgtype.UUID
	var parentComment *db.Comment
	if pid := strings.TrimSpace(req.ParentID); pid != "" {
		if _, err := uuid.Parse(pid); err != nil {
			writeError(w, http.StatusBadRequest, "invalid parent")
			return
		}
		parent = parseUUID(pid)
		if pc, err := h.Queries.GetCommentInWorkspace(r.Context(), db.GetCommentInWorkspaceParams{
			ID:          parent,
			WorkspaceID: issue.WorkspaceID,
		}); err == nil && uuidToString(pc.IssueID) == uuidToString(issue.ID) {
			parentComment = &pc
		}
	}
	authorID := share.CreatedBy.String()
	created, err := h.Queries.CreateComment(r.Context(), db.CreateCommentParams{
		ID:          dbid.NewV7(),
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		AuthorType:  "member",
		AuthorID:    parseUUID(authorID),
		Content:     content,
		Type:        "comment",
		ParentID:    parent,
	})
	if err != nil {
		slog.Warn("public share comment failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create comment")
		return
	}
	comment := created.Comment()
	resp := commentToResponse(comment, nil, nil)
	resp.IssueRevision = created.IssueRevision

	h.publish(protocol.EventCommentCreated, uuidToString(issue.WorkspaceID), "member", authorID, map[string]any{
		"comment":             resp,
		"issue_title":         issue.Title,
		"issue_assignee_type": textToPtr(issue.AssigneeType),
		"issue_assignee_id":   uuidToPtr(issue.AssigneeID),
		"issue_status":        issue.Status,
		"issue_revision":      created.IssueRevision,
		"via_public_share":    true,
	})

	_ = h.triggerTasksForComment(r.Context(), issue, comment, parentComment, "member", authorID, authorID, nil)

	guestNick, guestLoc, _ := parseGuestMeta(comment.Content)
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":             uuidToString(comment.ID),
		"content":        comment.Content,
		"created_at":     comment.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		"is_guest":       true,
		"author_name":    guestNick,
		"guest_nickname": guestNick,
		"guest_location": guestLoc,
	})
}

func formatGuestCommentBody(nickname, location, body string) string {
	var b strings.Builder
	b.WriteString(guestCommentPrefix)
	if nickname != "" {
		b.WriteString("·")
		b.WriteString(nickname)
	}
	b.WriteString("\n")
	if location != "" {
		b.WriteString("📍")
		b.WriteString(location)
		b.WriteString("\n")
	}
	b.WriteString(body)
	return b.String()
}

// parseGuestMeta extracts nickname/location from guest comment prefix.
func parseGuestMeta(content string) (nickname, location string, isGuest bool) {
	if !strings.HasPrefix(content, guestCommentPrefix) {
		return "", "", false
	}
	isGuest = true
	rest := content[len(guestCommentPrefix):]
	if strings.HasPrefix(rest, "·") {
		rest = rest[len("·"):]
		nl := strings.IndexByte(rest, '\n')
		if nl < 0 {
			return strings.TrimSpace(rest), "", true
		}
		nickname = strings.TrimSpace(rest[:nl])
		rest = rest[nl+1:]
	} else if strings.HasPrefix(rest, "\n") {
		rest = rest[1:]
	}
	if strings.HasPrefix(rest, "📍") {
		lineEnd := strings.IndexByte(rest, '\n')
		if lineEnd < 0 {
			location = strings.TrimSpace(rest[len("📍"):])
			return nickname, location, true
		}
		location = strings.TrimSpace(rest[len("📍"):lineEnd])
	}
	return nickname, location, true
}

func (h *Handler) publicShareAuthor(r *http.Request, authorType, authorID, guestNick string, isGuest bool) (name, avatar string) {
	if isGuest {
		if guestNick != "" {
			return guestNick, ""
		}
		return "访客", ""
	}
	switch authorType {
	case "agent":
		if a, err := h.Queries.GetAgent(r.Context(), parseUUID(authorID)); err == nil {
			n := a.Name
			if n == "" {
				n = "智能体"
			}
			if a.AvatarUrl.Valid {
				return n, a.AvatarUrl.String
			}
			return n, ""
		}
		return "智能体", ""
	case "member":
		if u, err := h.Queries.GetUser(r.Context(), parseUUID(authorID)); err == nil {
			n := u.Name
			if n == "" {
				n = u.Email
			}
			if n == "" {
				n = "团队"
			}
			if u.AvatarUrl.Valid {
				return n, u.AvatarUrl.String
			}
			return n, ""
		}
		return "团队", ""
	default:
		return authorType, ""
	}
}

func (h *Handler) publicShareAuthorName(r *http.Request, authorType, authorID, guestNick string, isGuest bool) string {
	name, _ := h.publicShareAuthor(r, authorType, authorID, guestNick, isGuest)
	return name
}

func publicWorkStatusLabel(status string) string {
	switch status {
	case "queued", "deferred":
		return "已排队，即将开始"
	case "dispatched":
		return "正在接手"
	default:
		return "正在处理"
	}
}

func (h *Handler) publicShareAssignee(r *http.Request, issue db.Issue) (name, typ, id string) {
	if !issue.AssigneeType.Valid || !issue.AssigneeID.Valid {
		return "", "", ""
	}
	typ = issue.AssigneeType.String
	id = uuidToString(issue.AssigneeID)
	switch typ {
	case "agent":
		if a, err := h.Queries.GetAgent(r.Context(), parseUUID(id)); err == nil {
			return a.Name, typ, id
		}
	case "member":
		if u, err := h.Queries.GetUser(r.Context(), parseUUID(id)); err == nil {
			if u.Name != "" {
				return u.Name, typ, id
			}
			return u.Email, typ, id
		}
	}
	return "", typ, id
}

func (h *Handler) loadPublicIssueShare(w http.ResponseWriter, r *http.Request, code string) (*issueshare.Share, db.Issue, db.Workspace, bool) {
	share, err := issueshare.GetActiveByCode(r.Context(), h.DB, code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load share")
		return nil, db.Issue{}, db.Workspace{}, false
	}
	if share == nil {
		writeError(w, http.StatusNotFound, "share not found")
		return nil, db.Issue{}, db.Workspace{}, false
	}
	issueUUID, err := util.ParseUUID(share.IssueID.String())
	if err != nil {
		writeError(w, http.StatusNotFound, "share not found")
		return nil, db.Issue{}, db.Workspace{}, false
	}
	issue, err := h.Queries.GetIssue(r.Context(), issueUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found")
		return nil, db.Issue{}, db.Workspace{}, false
	}
	ws, err := h.Queries.GetWorkspace(r.Context(), issue.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return nil, db.Issue{}, db.Workspace{}, false
	}
	return share, issue, ws, true
}

func (h *Handler) publicShareUnlocked(r *http.Request, share *issueshare.Share) bool {
	if tok := strings.TrimSpace(r.Header.Get("X-Share-Token")); tok != "" {
		return issueshare.VerifyAccessToken(shareTokenSecret(), share.Code, tok)
	}
	c, err := r.Cookie(shareAccessCookie + "_" + share.Code)
	if err != nil || c == nil {
		return false
	}
	return issueshare.VerifyAccessToken(shareTokenSecret(), share.Code, c.Value)
}

func (h *Handler) requirePublicShareAccess(w http.ResponseWriter, r *http.Request, share *issueshare.Share) bool {
	if share.AuthMode == "none" || h.publicShareUnlocked(r, share) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "password required")
	return false
}
