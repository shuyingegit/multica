// Package issueshare stores SCS-fork public conversation shares for issues
// (and helpers shared with chat session shares).
package issueshare

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Share struct {
	ID           uuid.UUID
	WorkspaceID  uuid.UUID
	IssueID      uuid.UUID
	Code         string
	AuthMode     string // none | password
	PasswordHash string
	CutoffAt     time.Time
	CreatedBy    uuid.UUID
	IsActive     bool
	CreatedAt    time.Time
}

func NewCode() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashPassword stores a simple keyed hash (not a login password store).
func HashPassword(secret, password string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(password))
	return hex.EncodeToString(mac.Sum(nil))
}

func CheckPassword(secret, password, hash string) bool {
	if hash == "" || password == "" {
		return false
	}
	want, err := hex.DecodeString(hash)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(password))
	return hmac.Equal(mac.Sum(nil), want)
}

// Issue access token: code|exp unix, HMAC signed, base64url.
func MintAccessToken(secret, code string, ttl time.Duration) string {
	exp := time.Now().Add(ttl).Unix()
	payload := fmt.Sprintf("%s|%d", code, exp)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + sig))
}

func VerifyAccessToken(secret, code, token string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return false
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 {
		return false
	}
	if parts[0] != code {
		return false
	}
	var exp int64
	if _, err := fmt.Sscanf(parts[1], "%d", &exp); err != nil {
		return false
	}
	if time.Now().Unix() > exp {
		return false
	}
	payload := parts[0] + "|" + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(parts[2]))
}

func GetActiveByIssue(ctx context.Context, db DB, issueID uuid.UUID) (*Share, error) {
	row := db.QueryRow(ctx, `
		SELECT id, workspace_id, issue_id, code, auth_mode, COALESCE(password_hash, ''),
		       cutoff_at, created_by, is_active, created_at
		FROM issue_public_share
		WHERE issue_id = $1 AND is_active = true
		LIMIT 1`, issueID)
	return scanShare(row)
}

func GetActiveByCode(ctx context.Context, db DB, code string) (*Share, error) {
	row := db.QueryRow(ctx, `
		SELECT id, workspace_id, issue_id, code, auth_mode, COALESCE(password_hash, ''),
		       cutoff_at, created_by, is_active, created_at
		FROM issue_public_share
		WHERE code = $1 AND is_active = true
		LIMIT 1`, code)
	return scanShare(row)
}

type scannable interface {
	Scan(dest ...any) error
}

func scanShare(row scannable) (*Share, error) {
	var s Share
	err := row.Scan(
		&s.ID, &s.WorkspaceID, &s.IssueID, &s.Code, &s.AuthMode, &s.PasswordHash,
		&s.CutoffAt, &s.CreatedBy, &s.IsActive, &s.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func RevokeActiveForIssue(ctx context.Context, db DB, issueID uuid.UUID) error {
	_, err := db.Exec(ctx, `
		UPDATE issue_public_share
		SET is_active = false, revoked_at = now()
		WHERE issue_id = $1 AND is_active = true`, issueID)
	return err
}

func Insert(ctx context.Context, db DB, s *Share) error {
	_, err := db.Exec(ctx, `
		INSERT INTO issue_public_share
		  (id, workspace_id, issue_id, code, auth_mode, password_hash, cutoff_at, created_by, is_active, created_at)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,true,$9)`,
		s.ID, s.WorkspaceID, s.IssueID, s.Code, s.AuthMode, s.PasswordHash,
		s.CutoffAt, s.CreatedBy, s.CreatedAt,
	)
	return err
}

func UpdateAuth(ctx context.Context, db DB, id uuid.UUID, mode, hash string) error {
	_, err := db.Exec(ctx, `
		UPDATE issue_public_share
		SET auth_mode = $2, password_hash = NULLIF($3, '')
		WHERE id = $1 AND is_active = true`, id, mode, hash)
	return err
}

type CommentRow struct {
	ID             uuid.UUID
	AuthorType     string
	AuthorID       uuid.UUID
	Content        string
	Type           string
	CreatedAt      time.Time
	ParentID       *uuid.UUID
	ResolvedAt     *time.Time
	ThreadResolved bool
}

func ListPublicComments(ctx context.Context, db DB, issueID, workspaceID uuid.UUID, since time.Time, limit int) ([]CommentRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := db.Query(ctx, `
		SELECT c.id, c.author_type, c.author_id, c.content, c.type, c.created_at,
		       c.parent_id, c.resolved_at,
		       EXISTS (
		         WITH RECURSIVE anc AS (
		           SELECT id, parent_id, resolved_at, 0 AS depth
		           FROM comment
		           WHERE id = c.id
		           UNION ALL
		           SELECT p.id, p.parent_id, p.resolved_at, anc.depth + 1
		           FROM comment p
		           JOIN anc ON p.id = anc.parent_id
		           WHERE p.deleted_at IS NULL AND anc.depth < 20
		         )
		         SELECT 1 FROM anc WHERE resolved_at IS NOT NULL
		       ) AS thread_resolved
		FROM comment c
		WHERE c.issue_id = $1 AND c.workspace_id = $2
		  AND c.deleted_at IS NULL
		  AND c.type IN ('comment', 'progress_update')
		  AND c.created_at >= $3
		ORDER BY c.created_at ASC, c.id ASC
		LIMIT $4`, issueID, workspaceID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommentRow
	for rows.Next() {
		var c CommentRow
		if err := rows.Scan(
			&c.ID, &c.AuthorType, &c.AuthorID, &c.Content, &c.Type, &c.CreatedAt,
			&c.ParentID, &c.ResolvedAt, &c.ThreadResolved,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type WorkRow struct {
	AgentID   uuid.UUID
	AgentName string
	Status    string
	Since     time.Time
}

// ListOpenWork returns agents currently queued or running on the issue so a
// public visitor can see that someone picked the request up.
func ListOpenWork(ctx context.Context, db DB, issueID uuid.UUID) ([]WorkRow, error) {
	rows, err := db.Query(ctx, `
		SELECT a.id,
		       COALESCE(NULLIF(btrim(a.name), ''), '智能体'),
		       t.status,
		       COALESCE(t.started_at, t.created_at)
		FROM agent_task_queue t
		JOIN agent a ON a.id = t.agent_id
		WHERE t.issue_id = $1
		  AND t.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
		ORDER BY COALESCE(t.started_at, t.created_at) ASC
		LIMIT 8`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkRow
	for rows.Next() {
		var w WorkRow
		if err := rows.Scan(&w.AgentID, &w.AgentName, &w.Status, &w.Since); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

type ProgressRow struct {
	ID        uuid.UUID
	AgentName string
	Type      string
	Tool      string
	Content   string
	CreatedAt time.Time
}

// ListIssueProgress returns the agent's step-by-step record on this issue,
// including steps from tasks that already finished, so a guest can read the
// whole process and not only the line that is running right now.
func ListIssueProgress(ctx context.Context, db DB, issueID uuid.UUID, since time.Time) ([]ProgressRow, error) {
	rows, err := db.Query(ctx, `
		SELECT m.id,
		       COALESCE(NULLIF(btrim(a.name), ''), '智能体'),
		       m.type,
		       COALESCE(m.tool, ''),
		       COALESCE(NULLIF(m.content, ''), NULLIF(m.output, ''), ''),
		       m.created_at
		FROM task_message m
		JOIN agent_task_queue t ON t.id = m.task_id
		JOIN agent a ON a.id = t.agent_id
		WHERE t.issue_id = $1
		  AND m.created_at >= $2
		  AND m.type IN ('text', 'thinking', 'tool_use', 'tool_result', 'error')
		ORDER BY m.created_at DESC, m.seq DESC
		LIMIT 400`, issueID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProgressRow
	for rows.Next() {
		var p ProgressRow
		if err := rows.Scan(&p.ID, &p.AgentName, &p.Type, &p.Tool, &p.Content, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}
