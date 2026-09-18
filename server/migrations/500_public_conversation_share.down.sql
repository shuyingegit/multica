DROP INDEX IF EXISTS chat_session_public_share_one_active;
DROP INDEX IF EXISTS chat_session_public_share_code_uidx;
DROP TABLE IF EXISTS chat_session_public_share;

DROP INDEX IF EXISTS issue_public_share_workspace_idx;
DROP INDEX IF EXISTS issue_public_share_one_active_per_issue;
DROP INDEX IF EXISTS issue_public_share_code_uidx;
DROP TABLE IF EXISTS issue_public_share;
