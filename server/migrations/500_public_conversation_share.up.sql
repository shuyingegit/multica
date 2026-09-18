-- SCS fork: Issue public conversation share (external guest chat).
-- Guest sees only comments at/after cutoff_at; posts land on the real issue.
CREATE TABLE IF NOT EXISTS issue_public_share (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL,
    issue_id       UUID NOT NULL,
    code           TEXT NOT NULL,
    auth_mode      TEXT NOT NULL CHECK (auth_mode IN ('none', 'password')),
    password_hash  TEXT,
    cutoff_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_public_share_code_uidx
    ON issue_public_share (code);

CREATE UNIQUE INDEX IF NOT EXISTS issue_public_share_one_active_per_issue
    ON issue_public_share (issue_id)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS issue_public_share_workspace_idx
    ON issue_public_share (workspace_id);

-- Chat session public share (same product model, session-scoped).
CREATE TABLE IF NOT EXISTS chat_session_public_share (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL,
    session_id     UUID NOT NULL,
    code           TEXT NOT NULL,
    auth_mode      TEXT NOT NULL CHECK (auth_mode IN ('none', 'password')),
    password_hash  TEXT,
    cutoff_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_session_public_share_code_uidx
    ON chat_session_public_share (code);

CREATE UNIQUE INDEX IF NOT EXISTS chat_session_public_share_one_active
    ON chat_session_public_share (session_id)
    WHERE is_active;
