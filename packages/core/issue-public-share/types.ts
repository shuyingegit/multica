export type IssuePublicShareAuthMode = "none" | "password";

export interface IssuePublicShare {
  code: string;
  auth_mode: IssuePublicShareAuthMode;
  cutoff_at: string;
  path: string;
  is_active: boolean;
  created_at: string;
}

export interface IssuePublicShareMeta {
  code: string;
  auth_mode: IssuePublicShareAuthMode;
  needs_password: boolean;
  unlocked: boolean;
  title: string;
  identifier: string;
  cutoff_at: string;
}

export interface PublicShareComment {
  id: string;
  author_type: string;
  author_id: string;
  content: string;
  type: string;
  created_at: string;
  is_guest?: boolean;
}

export function buildPublicIssueShareURL(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function stripGuestPrefix(content: string): string {
  const prefix = "【外部访客】\n";
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}
