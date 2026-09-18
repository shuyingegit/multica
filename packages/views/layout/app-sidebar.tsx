"use client";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";

import { issueStatusCategory } from "@multica/core/issues";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { AppLink, useNavigation } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import { JoinDiscordCard } from "./join-discord-card";
import { TaskNotifyAppBaseSync } from "../settings/components/task-notify-app-base-sync";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Layers,
  ChevronDown,
  ChevronRight,
  LogOut,
  Plus,
  Check,
  SquarePen,
  X,
  Loader2,
} from "lucide-react";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@multica/ui/components/ui/collapsible";
import { CappedNumberFlow } from "@multica/ui/components/ui/number-flow";
import { StatusIcon } from "../issues/components/status-icon";
import { useIssueDraftStore } from "@multica/core/issues/stores/draft-store";
import { openCreateIssueWithPreference } from "@multica/core/issues/stores/create-mode-store";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@multica/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useAuthStore } from "@multica/core/auth";
import { issueViewDetailOptions } from "@multica/core/issue-views/queries";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@multica/core/issue-views/active-view-store";
import { useCurrentWorkspace, useWorkspacePaths, paths } from "@multica/core/paths";
import { workspaceListOptions, myInvitationListOptions, workspaceKeys } from "@multica/core/workspace/queries";
import { resolvePublicFileUrl } from "@multica/core/workspace/avatar-url";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxUnreadSummaryOptions, useInboxUnreadCount, hasOtherWorkspaceUnread, unreadWorkspaceIds } from "@multica/core/inbox/queries";
import { chatSessionsOptions } from "@multica/core/chat/queries";
import { countUnreadChatMessages } from "@multica/core/chat/unread";
import { useChatStore } from "@multica/core/chat";
import { api, ApiError } from "@multica/core/api";
import { useConfigStore } from "@multica/core/config";
import { pinListOptions } from "@multica/core/pins/queries";
import { useDeletePin, useReorderPins } from "@multica/core/pins/mutations";
import {
  describePinRelativeAge,
  selectPinUnreadCount,
  usePinUnreadStore,
} from "@multica/core/pins";
import {
  issueDetailOptions,
  issueTimelineOptions,
} from "@multica/core/issues/queries";
import { mirrorIssueDetailCache } from "@multica/core/issues/prefetch";
import { projectDetailOptions } from "@multica/core/projects/queries";
import { agentTaskSnapshotOptions } from "@multica/core/agents";
import { useWSEvent } from "@multica/core/realtime";
import type { AgentTask, CommentCreatedPayload, Issue, PinnedItem } from "@multica/core/types";
import { selectIssueTasks } from "../issues/surface/activity";
import { useLogout } from "../auth";
import { ProjectIcon } from "../projects/components/project-icon";
import { routeIconForPath } from "./route-icon-components";
import { useT } from "../i18n";
import {
  useShortcut,
} from "@multica/core/shortcuts";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { useAppForeground } from "../common/use-app-foreground";

// Top-level nav items stay active when the user is on a child route
// (e.g. "Projects" stays lit on /:slug/projects/:id). Pinned items keep
// strict equality elsewhere — a pinned project shouldn't highlight on
// sub-pages of itself.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Stable empty arrays for query defaults. Using an inline `= []` default on
// `useQuery` creates a new array reference on every render when `data` is
// undefined (e.g. query disabled or loading) — which in turn breaks any
// `useEffect`/`useMemo` that depends on the value, and can trigger infinite
// re-render loops when the effect itself calls `setState`.
const EMPTY_PINS: PinnedItem[] = [];
const EMPTY_WORKSPACES: Awaited<ReturnType<typeof api.listWorkspaces>> = [];
const EMPTY_INVITATIONS: Awaited<ReturnType<typeof api.listMyInvitations>> = [];
const EMPTY_INBOX_SUMMARY: Awaited<ReturnType<typeof api.getInboxUnreadSummary>> = [];
const PINNED_PREVIEW_LIMIT = 5;

// Nav items reference WorkspacePaths method names so they can be resolved
// against the current workspace slug at render time (see AppSidebar body).
// Only parameterless paths are valid nav destinations.
type NavKey =
  | "inbox"
  | "chat"
  | "myIssues"
  | "issues"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "settings";

// Static schema (key only) — labels resolved at render via useT("layout"),
// icons derived from the destination path via routeIconForPath.
type NavLabelKey =
  | "inbox"
  | "chat"
  | "my_issues"
  | "issues"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "settings";

// Nav icons are NOT declared here: they are derived from each item's
// destination path at render time, so the sidebar and the desktop tab bar
// always agree. See route-icon-components.tsx.
const personalNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "inbox", labelKey: "inbox" },
  { key: "myIssues", labelKey: "my_issues" },
  { key: "chat", labelKey: "chat" },
];

const workNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "issues", labelKey: "issues" },
  { key: "projects", labelKey: "projects" },
  { key: "autopilots", labelKey: "autopilots" },
];

const aiTeamNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "agents", labelKey: "agents" },
  { key: "squads", labelKey: "squads" },
  { key: "skills", labelKey: "skills" },
  { key: "runtimes", labelKey: "runtimes" },
];

const utilityNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "usage", labelKey: "usage" },
  { key: "settings", labelKey: "settings" },
];

const NAV_ITEM_CLASS_NAME =
  "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground";

/**
 * Last `/issues/<segment>` segment of a path, URL-decoded. Null when the
 * path is not an issue detail route.
 */
export function issueDetailSegment(pathname: string): string | null {
  const match = /\/issues\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Issue detail URLs are rewritten to the human identifier (MUL-123) after
 * load, but pins store the UUID. Match either spelling so the pinned row
 * stays highlighted on the page the user is actually looking at.
 */
export function isIssuePinPathActive(
  pathname: string,
  issueDetailHref: (id: string) => string,
  issueId: string,
  identifier?: string | null,
): boolean {
  const segment = issueDetailSegment(pathname);
  if (segment) {
    if (segment === issueId) return true;
    if (identifier && segment === identifier) return true;
    // Identifiers are case-insensitive on the server; match that here so a
    // mixed-case address bar still lights the pin.
    if (identifier && segment.toLowerCase() === identifier.toLowerCase()) {
      return true;
    }
  }
  if (pathname === issueDetailHref(issueId)) return true;
  if (identifier && pathname === issueDetailHref(identifier)) return true;
  return false;
}

function DraftDot() {
  const hasDraft = useIssueDraftStore((s) => s.hasDraft());
  if (!hasDraft) return null;
  return <span className="absolute top-0 right-0 size-1.5 rounded-full bg-brand" />;
}

/**
 * Presentational pin row. The `label` and `iconNode` are computed by the
 * parent `PinRow` from cached issue / project detail queries — keeping
 * this component dumb means the dnd-kit / navigation wiring lives in
 * one place and the data flow is explicit.
 */
function SortablePinItem({
  pin,
  href,
  pathname,
  onUnpin,
  label,
  iconNode,
  onNavigate,
  isActiveOverride,
  trailing,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  label: string;
  iconNode: React.ReactNode;
  /** Runs on a real click (not a drag-release) before navigation. */
  onNavigate?: () => void;
  /** Overrides the plain path comparison (view pins carry extra state). */
  isActiveOverride?: boolean;
  /** Right-edge cue: agent spinner and/or unread count for issue pins. */
  trailing?: React.ReactNode;
}) {
  const { t } = useT("layout");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id });
  const wasDragged = useRef(false);

  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isActive = isActiveOverride ?? pathname === href;

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      className={cn("group/pin", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={<AppLink href={href} newTabTitle={label} draggable={false} />}
        onClick={(event) => {
          if (wasDragged.current) {
            wasDragged.current = false;
            event.preventDefault();
            return;
          }
          onNavigate?.();
        }}
        className={cn(
          "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          // Force the accent fill when active. Pin rows render through AppLink
          // + dnd listeners; relying only on data-active has been flaky for
          // operators verifying the highlight. Matching the Work nav look.
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
          isDragging && "pointer-events-none",
        )}
      >
        {iconNode}
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
          style={{
            maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
          }}
        >{label}</span>
        {trailing}
        <Tooltip>
          <TooltipTrigger
            render={<span role="button" />}
            className="hidden size-2.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/pin:flex hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnpin();
            }}
          >
            <X className="size-1" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>{t(($) => $.sidebar.unpin_tooltip)}</TooltipContent>
        </Tooltip>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Refresh pin-rail relative ages about once a minute. */
function usePinAgeTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Issue pin with live run / new-reply cues. Agent tasks come from the shared
 * workspace snapshot (same cache as the agents-working chip). Unread is the
 * session pin-unread store — NOT inbox counts — so opening the app shows a
 * clean rail. New replies light the badge even on the open pin until the user
 * clicks the row or interacts with the issue detail (scroll / pointer).
 */
function IssuePinRow({
  pin,
  href,
  pathname,
  onUnpin,
  label,
  iconNode,
  isActive,
  issueId,
  wsId,
  lastActivityAt,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  label: string;
  iconNode: React.ReactNode;
  isActive: boolean;
  issueId: string;
  wsId: string;
  /** last_activity_at ?? updated_at — drives the compact age next to status. */
  lastActivityAt: string | null | undefined;
}) {
  const selectTasks = useCallback(
    (snapshot: AgentTask[]) => selectIssueTasks(snapshot, issueId),
    [issueId],
  );
  const { data: taskGroups } = useQuery({
    ...agentTaskSnapshotOptions(wsId),
    select: selectTasks,
  });
  const unreadCount = usePinUnreadStore(selectPinUnreadCount(issueId));
  const markPinRead = usePinUnreadStore((s) => s.markRead);
  const nowMs = usePinAgeTick();
  const age = describePinRelativeAge(lastActivityAt, nowMs);
  const ageLabel = age?.label ?? null;
  const ageToneClass =
    age?.tone === "fresh"
      ? "text-foreground/80"
      : age?.tone === "recent"
        ? "text-muted-foreground"
        : "text-muted-foreground/40";

  const isRunning =
    (taskGroups?.running.length ?? 0) > 0 || (taskGroups?.queued.length ?? 0) > 0;
  // Keep the unread cue visible on the active pin until intentional ack.
  // While a run is live, the spinner owns the trailing slot; unread shows
  // again once the run ends (typical "agent finished, you haven't looked").
  const showUnread = !isRunning && unreadCount > 0;
  const hasTrailing = isRunning || showUnread || !!ageLabel;

  const trailing = hasTrailing ? (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
      {isRunning ? (
        <>
          <Loader2 className="size-3 animate-spin text-brand" aria-hidden />
          <span className="tabular-nums" aria-label="running">
            ···
          </span>
        </>
      ) : showUnread ? (
        <span
          className="flex shrink-0 items-center gap-1"
          aria-label={`unread ${unreadCount}`}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <CappedNumberFlow
            value={unreadCount}
            animated={false}
            className="text-caption font-medium text-brand"
          />
        </span>
      ) : null}
      {ageLabel ? (
        <span
          className={cn("tabular-nums", ageToneClass)}
          title={lastActivityAt ?? undefined}
        >
          {ageLabel}
        </span>
      ) : null}
    </span>
  ) : null;

  return (
    <SortablePinItem
      pin={pin}
      href={href}
      pathname={pathname}
      onUnpin={onUnpin}
      label={label}
      iconNode={iconNode}
      isActiveOverride={isActive}
      trailing={trailing}
      onNavigate={() => markPinRead(issueId)}
    />
  );
}

/**
 * Smart wrapper that resolves a pin's display data (label + status/icon)
 * from the issue / project detail query cache. Both queries are declared
 * unconditionally with `enabled` gates so the hook order stays stable
 * regardless of `pin.item_type`.
 *
 * Loading: render a flat skeleton so the sidebar height doesn't jump.
 * Missing (deleted item / 404): render nothing — the row hides itself
 * until the user unpins manually or a server-side cascade catches up.
 */
function PinRow({
  pin,
  href,
  pathname,
  onUnpin,
  wsId,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  wsId: string;
}) {
  const isIssue = pin.item_type === "issue";
  const statusCatalog = useIssueStatuses(wsId);
  const isView = pin.item_type === "view";
  const p = useWorkspacePaths();
  const setActiveView = useActiveIssueViewStore((s) => s.setActive);
  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, pin.item_id),
    enabled: isIssue,
  });
  const projectQuery = useQuery({
    ...projectDetailOptions(wsId, pin.item_id),
    enabled: pin.item_type === "project",
  });
  const viewQuery = useQuery({
    ...issueViewDetailOptions(wsId, pin.item_id),
    enabled: isView,
  });

  const triggeredRef = useRef(false);
  useEffect(() => {
    // Views are exempt from 404-auto-unpin: an installed desktop client
    // talking to an older backend without the view endpoints sees 404 for
    // every view pin — auto-unpinning would permanently delete them all.
    // A deleted view's row simply hides instead.
    if (isView) return;
    const err = isIssue ? issueQuery.error : projectQuery.error;
    if (err instanceof ApiError && err.status === 404 && !triggeredRef.current) {
      triggeredRef.current = true;
      onUnpin();
    }
  }, [isIssue, isView, issueQuery.error, onUnpin, projectQuery.error]);

  const activeViewByContainer = useActiveIssueViewStore((s) => s.active);
  if (isView) {
    if (viewQuery.isPending) return <PinSkeleton />;
    if (viewQuery.isError || !viewQuery.data) return null;
    const view = viewQuery.data;
    // One resolved scope drives the path AND the container key so an
    // unrecognised scope_type from a newer backend degrades coherently.
    const scopeType: "workspace" | "my" | "project" =
      view.scope_type === "my"
        ? "my"
        : view.scope_type === "project" && view.scope_id
          ? "project"
          : "workspace";
    const viewPath =
      scopeType === "my"
        ? p.myIssues()
        : scopeType === "project"
          ? p.projectDetail(view.scope_id!)
          : p.issues();
    const containerKey = issueViewContainerKey(wsId, {
      scope_type: scopeType,
      scope_id: scopeType === "project" ? view.scope_id : null,
    });
    return (
      <SortablePinItem
        pin={pin}
        // ?view= keeps a web reload on the view for the surfaces that mount
        // the URL-sync hook (/issues, /my-issues). Project pages don't sync
        // yet — there the query is inert and reload falls back to the plain
        // page; click-through activation still works everywhere.
        href={`${viewPath}?view=${view.id}`}
        pathname={pathname}
        onUnpin={onUnpin}
        label={view.name}
        iconNode={<Layers className="!size-3.5 shrink-0" />}
        // Active only when this exact view is open on its surface — the
        // path alone also matches the plain tab.
        isActiveOverride={
          pathname === viewPath && activeViewByContainer[containerKey] === view.id
        }
        onNavigate={() => setActiveView(containerKey, view.id)}
      />
    );
  }

  if (isIssue) {
    if (issueQuery.isPending) return <PinSkeleton />;
    if (issueQuery.isError || !issueQuery.data) return null;
    const issue = issueQuery.data;
    const label = issue.title;
    // Canonical URL uses the identifier; UUID links still resolve but get
    // rewritten — highlight must match the address bar the user sees.
    const issueHref = p.issueDetail(issue.identifier || issue.id);
    const isActive = isIssuePinPathActive(pathname, p.issueDetail, issue.id, issue.identifier);
    const iconNode = (
      /* Override parent [&_svg]:size-4 — pinned items need smaller icons to match sm size */
      <StatusIcon
        status={issue.status}
        color={statusCatalog.colorOf(issue.status)}
        icon={statusCatalog.iconOf(issue.status)}
        category={issueStatusCategory(issue) ?? undefined}
        className="!size-3.5 shrink-0"
      />
    );
    return (
      <IssuePinRow
        pin={pin}
        href={issueHref}
        pathname={pathname}
        onUnpin={onUnpin}
        label={label}
        iconNode={iconNode}
        isActive={isActive}
        issueId={issue.id}
        wsId={wsId}
        lastActivityAt={issue.last_activity_at ?? issue.updated_at}
      />
    );
  }

  if (projectQuery.isPending) return <PinSkeleton />;
  if (projectQuery.isError || !projectQuery.data) return null;
  const project = projectQuery.data;
  const iconNode = <ProjectIcon project={project} size="sm" />;
  return (
    <SortablePinItem
      pin={pin}
      href={href}
      pathname={pathname}
      onUnpin={onUnpin}
      label={project.title}
      iconNode={iconNode}
    />
  );
}

function PinSkeleton() {
  return (
    <SidebarMenuItem>
      <div className="flex h-7 w-full items-center gap-2 px-2">
        <div className="size-3.5 shrink-0 rounded-sm bg-sidebar-accent/40" />
        <div className="h-3 w-24 rounded-xs bg-sidebar-accent/40" />
      </div>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  /** Rendered above SidebarHeader (e.g. desktop traffic light spacer) */
  topSlot?: React.ReactNode;
  /** Rendered in the header between workspace switcher and new-issue button (e.g. search trigger) */
  searchSlot?: React.ReactNode;
  /** Extra className for SidebarHeader */
  headerClassName?: string;
  /** Extra style for SidebarHeader */
  headerStyle?: React.CSSProperties;
}

export function AppSidebar({ topSlot, searchSlot, headerClassName, headerStyle }: AppSidebarProps = {}) {
  const { t } = useT("layout");
  const { pathname, push } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);
  const logout = useLogout();
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  const { data: workspaces = EMPTY_WORKSPACES } = useQuery(workspaceListOptions());
  const { data: myInvitations = EMPTY_INVITATIONS } = useQuery(myInvitationListOptions());
  const workspaceCreationDisabled = useConfigStore((s) => s.workspaceCreationDisabled);

  // On a phone the sidebar is a Sheet covering the page, so navigating out of
  // it has to dismiss it — otherwise the destination renders underneath and the
  // tap reads as "nothing happened". Closing on `pathname` rather than on each
  // link's onClick covers every route out of here at once: the nav groups, the
  // pinned items, the workspace switcher's programmatic push, and anything
  // added later. `setOpenMobile` is a no-op on desktop, where the sheet is not
  // the sidebar's rendering at all.
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const wsId = workspace?.id;
  // Nav badge. Reads the cross-workspace unread summary fetched just below
  // for the switcher dot, so the count costs no request of its own — it used
  // to download the whole inbox list here just to count it (MUL-6967).
  const unreadCount = useInboxUnreadCount(wsId);
  // Chat tab unread badge: IM-style total of unread *messages* across chat
  // threads (countUnreadChatMessages is the shared definition — mobile's tab
  // badge derives from the same function, keeping the platforms in agreement).
  const { data: chatSessions = [] } = useQuery({
    ...chatSessionsOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  // The session the user is reading right now must not count: the thread list
  // renders its row badge as 0 (auto mark-read is about to clear it), and a
  // reply landing in the open conversation would otherwise flash a sidebar
  // count with no matching row. "Reading right now" = a session is active, a
  // chat surface is actually showing it (chat page route or the floating
  // window), AND the app is in the foreground. When the app is backgrounded,
  // auto mark-read is suppressed (MUL-4485) so the reply stays unread — the
  // badge must count it, or the notification is silently eaten while the user
  // is away. A remembered selection while both surfaces are closed also still
  // counts, for the same reason.
  const activeChatSessionId = useChatStore((s) => s.activeSessionId);
  const floatingChatOpen = useChatStore((s) => s.isOpen);
  const appForeground = useAppForeground();
  const chatHref = p.chat();
  const viewedChatSessionId =
    appForeground && (floatingChatOpen || isNavActive(pathname, chatHref))
      ? activeChatSessionId
      : null;
  const chatUnreadCount = React.useMemo(
    () => countUnreadChatMessages(chatSessions, viewedChatSessionId),
    [chatSessions, viewedChatSessionId],
  );
  // Cross-workspace unread summary backs the workspace-switcher dot. One
  // shared cache entry across workspaces; gated on an active workspace since
  // the endpoint resolves through the workspace-member middleware.
  const { data: unreadSummary = EMPTY_INBOX_SUMMARY } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
  });
  const otherWorkspaceUnread = React.useMemo(
    () => hasOtherWorkspaceUnread(unreadSummary, wsId),
    [unreadSummary, wsId],
  );
  // Which workspaces have unread, so the switcher dropdown can point at the
  // specific one(s) rather than just the aggregate avatar dot.
  const unreadWsIds = React.useMemo(() => unreadWorkspaceIds(unreadSummary), [unreadSummary]);
  const { data: pinnedItems = EMPTY_PINS } = useQuery({
    ...pinListOptions(wsId ?? "", userId ?? ""),
    enabled: !!wsId && !!userId,
  });
  const deletePin = useDeletePin();
  const reorderPins = useReorderPins();
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);
  const getPinHref = useCallback(
    (pin: PinnedItem) =>
      pin.item_type === "issue"
        ? p.issueDetail(pin.item_id)
        : pin.item_type === "project"
          ? p.projectDetail(pin.item_id)
          // Views know their target only after their detail loads — the row
          // resolves its own href; this placeholder never renders as a link.
          : "",
    [p],
  );

  // Local presentational copy of pinnedItems for drop-animation stability.
  // Follows TQ at rest; frozen during a drag gesture so a mid-drag cache
  // write (our own optimistic update, or a WS refetch) cannot reorder the
  // DOM under dnd-kit while its drop animation is still interpolating.
  const [localPinned, setLocalPinned] = useState<PinnedItem[]>(pinnedItems);
  const [localPinnedWsId, setLocalPinnedWsId] = useState<string | null>(wsId ?? null);
  const [expandedPinsWorkspaceId, setExpandedPinsWorkspaceId] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPinned(pinnedItems);
    }
  }, [pinnedItems]);
  useEffect(() => {
    setLocalPinnedWsId(wsId ?? null);
  }, [wsId]);
  const visiblePinned = localPinnedWsId === (wsId ?? null) ? localPinned : EMPTY_PINS;
  // Fetch issue details for ALL issue pins (not only the preview slice) so we
  // can sort by recent activity before applying the 5-item preview limit.
  const allIssuePins = React.useMemo(
    () => visiblePinned.filter((pin) => pin.item_type === "issue"),
    [visiblePinned],
  );
  const allPinnedIssueDetails = useQueries({
    queries: allIssuePins.map((pin) => ({
      ...issueDetailOptions(wsId ?? "", pin.item_id),
      enabled: !!wsId,
    })),
  });
  const activityByIssueId = React.useMemo(() => {
    const map = new Map<string, number>();
    allIssuePins.forEach((pin, index) => {
      const issue = allPinnedIssueDetails[index]?.data;
      const raw = issue?.last_activity_at || issue?.updated_at || pin.created_at;
      const t = raw ? Date.parse(raw) : 0;
      map.set(pin.item_id, Number.isFinite(t) ? t : 0);
    });
    return map;
  }, [allIssuePins, allPinnedIssueDetails]);
  // Recent activity first; custom pin.position as tiebreaker among peers.
  const activitySortedPinned = React.useMemo(() => {
    return [...visiblePinned].sort((a, b) => {
      const actA =
        a.item_type === "issue" ? (activityByIssueId.get(a.item_id) ?? 0) : Date.parse(a.created_at) || 0;
      const actB =
        b.item_type === "issue" ? (activityByIssueId.get(b.item_id) ?? 0) : Date.parse(b.created_at) || 0;
      if (actA !== actB) return actB - actA;
      return (a.position ?? 0) - (b.position ?? 0);
    });
  }, [visiblePinned, activityByIssueId]);
  const pinsExpanded = expandedPinsWorkspaceId === wsId;
  const displayedPinned = pinsExpanded
    ? activitySortedPinned
    : activitySortedPinned.slice(0, PINNED_PREVIEW_LIMIT);
  // Subscribe to every displayed issue pin's detail so identifier-based
  // active matching re-renders when the cache fills (getQueryData alone
  // would leave "Issues" lit until an unrelated parent update).
  const displayedIssuePins = displayedPinned.filter((pin) => pin.item_type === "issue");
  const pinnedIssueById = React.useMemo(() => {
    const map = new Map<string, Issue>();
    allIssuePins.forEach((pin, index) => {
      const data = allPinnedIssueDetails[index]?.data;
      if (data) map.set(pin.item_id, data);
    });
    return map;
  }, [allIssuePins, allPinnedIssueDetails]);

  // Pin unread baseline: every visible issue pin starts "read" for this tab
  // session. Entering a pin clears its badge; replies bump even while open
  // until the user clicks the pin or interacts with the issue detail.
  const seedPinUnread = usePinUnreadStore((s) => s.seedIfNeeded);
  const setViewingPinIssue = usePinUnreadStore((s) => s.setViewingIssue);
  const notePinComment = usePinUnreadStore((s) => s.noteIncomingComment);
  useEffect(() => {
    if (displayedIssuePins.length === 0) return;
    seedPinUnread(displayedIssuePins.map((pin) => pin.item_id));
  }, [displayedIssuePins, seedPinUnread]);
  useEffect(() => {
    // Resolve the open issue UUID from the address bar (identifier or UUID)
    // against the pin detail cache so mark-read matches store keys.
    const segment = issueDetailSegment(pathname);
    if (!segment) {
      setViewingPinIssue(null);
      return;
    }
    for (const issue of pinnedIssueById.values()) {
      if (
        issue.id === segment ||
        issue.identifier === segment ||
        (issue.identifier &&
          issue.identifier.toLowerCase() === segment.toLowerCase())
      ) {
        setViewingPinIssue(issue.id);
        return;
      }
    }
    // UUID URL before pin detail fills — still mark that UUID read.
    setViewingPinIssue(/^[0-9a-f-]{36}$/i.test(segment) ? segment : null);
  }, [pathname, pinnedIssueById, setViewingPinIssue]);

  const onPinCommentCreated = useCallback(
    (payload: unknown) => {
      const { comment } = (payload ?? {}) as CommentCreatedPayload;
      if (!comment?.issue_id) return;
      const fromSelf =
        comment.author_type === "member" &&
        !!userId &&
        comment.author_id === userId;
      notePinComment(comment.issue_id, { fromSelf });
    },
    [notePinComment, userId],
  );
  useWSEvent("comment:created", onPinCommentCreated);

  // Warm the identifier-keyed detail + timeline caches so pin A↔B↔C switches
  // skip the resolve skeleton and land on cached scroll restore sooner.
  useEffect(() => {
    if (!wsId) return;
    for (const issue of pinnedIssueById.values()) {
      mirrorIssueDetailCache(queryClient, wsId, issue);
      void queryClient.prefetchQuery(issueDetailOptions(wsId, issue.id));
      if (issue.identifier) {
        void queryClient.prefetchQuery(
          issueDetailOptions(wsId, issue.identifier),
        );
      }
      void queryClient.prefetchQuery(issueTimelineOptions(issue.id));
    }
  }, [pinnedIssueById, queryClient, wsId]);

  // View pins are absent here (their href resolves async): while a view
  // pin is active the plain nav row for its surface stays highlighted too.
  // Accepted — suppressing it would need every view detail lifted up here.
  // Issue pins: address bar uses identifier after rewrite; match UUID or
  // loaded identifier so "Issues" does not stay lit over an open pinned issue.
  const isActivePinnedRoute = displayedPinned.some((pin) => {
    if (pin.item_type === "issue") {
      const cached = pinnedIssueById.get(pin.item_id);
      return isIssuePinPathActive(
        pathname,
        p.issueDetail,
        pin.item_id,
        cached?.identifier,
      );
    }
    return pathname === getPinHref(pin);
  });

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localPinned.findIndex((p) => p.id === active.id);
      const newIndex = localPinned.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localPinned, oldIndex, newIndex);
      setLocalPinned(reordered);
      reorderPins.mutate(reordered);
    },
    [localPinned, reorderPins],
  );

  const acceptInvitationMut = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    // After accepting an invitation, navigate INTO the newly-joined workspace.
    // Otherwise the user stays on their current workspace and just sees the
    // new one appear in the dropdown — silent and confusing (this is MUL-820).
    onSuccess: async (_, invitationId) => {
      const invitation = myInvitations.find((i) => i.id === invitationId);
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // staleTime: 0 forces a real network fetch — we need the joined workspace
      // in the list before we can resolve its slug for navigation.
      const list = await queryClient.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = invitation
        ? list.find((w) => w.id === invitation.workspace_id)
        : null;
      if (joined) {
        push(paths.workspace(joined.slug).issues());
      }
    },
    onError: () => {
      // "invitation is not pending" means the invite was concluded from
      // another surface while this row was on screen. Refetch so the stale
      // row drops instead of sticking around until restart — a silent
      // failure here reads as "the button does nothing".
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });
  const declineInvitationMut = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    // Either outcome must refresh the list: success drops the declined row,
    // and a failure ("invitation is not pending") means the invite was
    // concluded from another surface — refetch drops the stale row.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });

  const createIssueShortcut = useShortcut("createIssue");

  return (
      <>
      <TaskNotifyAppBaseSync />
      <Sidebar variant="inset">
        {topSlot}
        {/* Workspace Switcher */}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton>
                      <span className="relative">
                        <WorkspaceAvatar name={workspace?.name ?? "M"} avatarUrl={workspace?.avatar_url} size="sm" />
                        {/* Shared brand dot: a pending invitation OR another
                            workspace with unread inbox items. The active
                            workspace's own unread stays on the Inbox nav count
                            (below), so it is deliberately excluded here. */}
                        {(myInvitations.length > 0 || otherWorkspaceUnread) && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-1 ring-sidebar" />
                        )}
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {workspace?.name ?? "Multica"}
                      </span>
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent
                  className="w-auto min-w-56"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <ActorAvatar
                      name={user?.name ?? ""}
                      initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                      avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium leading-tight">
                        {user?.name}
                      </p>
                      <p className="truncate text-caption text-muted-foreground leading-tight">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-caption text-muted-foreground">
                      {t(($) => $.sidebar.workspaces_label)}
                    </DropdownMenuLabel>
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        render={
                          <AppLink href={paths.workspace(ws.slug).issues()} />
                        }
                      >
                        <WorkspaceAvatar name={ws.name} avatarUrl={ws.avatar_url} size="sm" />
                        <span className="flex-1 truncate">{ws.name}</span>
                        {/* Points at the specific workspace holding unread
                            inbox items. Sits in the same right-edge slot as the
                            active-workspace check; the active workspace is
                            excluded (its unread is the Inbox nav count), so dot
                            and check never collide on one row. */}
                        {ws.id !== workspace?.id && unreadWsIds.has(ws.id) && (
                          <span className="size-2 rounded-full bg-brand" />
                        )}
                        {ws.id === workspace?.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                    {!workspaceCreationDisabled && (
                      <DropdownMenuItem
                        onClick={() => push(paths.newWorkspace())}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t(($) => $.sidebar.create_workspace)}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {myInvitations.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-caption text-muted-foreground">
                          {t(($) => $.sidebar.pending_invitations_label)}
                        </DropdownMenuLabel>
                        {myInvitations.map((inv) => (
                          <div key={inv.id} className="flex items-center gap-2 px-2 py-1.5">
                            <WorkspaceAvatar name={inv.workspace_name ?? "W"} size="sm" />
                            <span className="flex-1 truncate text-body">{inv.workspace_name ?? t(($) => $.sidebar.invitation_workspace_fallback)}</span>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              disabled={acceptInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_join)}
                            </button>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded-xs bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                              disabled={declineInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                declineInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_decline)}
                            </button>
                          </div>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={logout}>
                      <LogOut className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.log_out)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarMenu>
            {searchSlot && (
              <SidebarMenuItem>
                {searchSlot}
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground"
                onClick={() => openCreateIssueWithPreference()}
              >
                <span className="relative">
                  <SquarePen />
                  <DraftDot />
                </span>
                <span>{t(($) => $.sidebar.new_issue)}</span>
                {createIssueShortcut ? (
                  <ShortcutKeycaps shortcut={createIssueShortcut} decorative className="pointer-events-none ml-auto" />
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {personalNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className={NAV_ITEM_CLASS_NAME}
                      >
                        <Icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                        {item.key === "inbox" && unreadCount > 0 && (
                          <CappedNumberFlow
                            value={unreadCount}
                            animated={false}
                            className="ml-auto text-caption"
                          />
                        )}
                        {item.key === "chat" && chatUnreadCount > 0 && (
                          <CappedNumberFlow
                            value={chatUnreadCount}
                            animated={false}
                            className="ml-auto text-caption"
                          />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {visiblePinned.length > 0 && (
            <Collapsible defaultOpen>
              <SidebarGroup className="group/pinned">
                <SidebarGroupLabel
                  render={<CollapsibleTrigger />}
                  className="group/trigger cursor-pointer hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
                >
                  <span>{t(($) => $.sidebar.pinned_label)}</span>
                  <ChevronRight className="!size-3 ml-1 stroke-[2.5] transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90" />
                  <span className="ml-auto text-micro text-muted-foreground opacity-0 transition-opacity group-hover/pinned:opacity-100">{visiblePinned.length}</span>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                      <SortableContext items={displayedPinned.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                        <SidebarMenu className="gap-0.5">
                          {displayedPinned.map((pin: PinnedItem) => (
                            <PinRow
                              key={pin.id}
                              pin={pin}
                              href={getPinHref(pin)}
                              pathname={pathname}
                              onUnpin={() => deletePin.mutate({ itemType: pin.item_type, itemId: pin.item_id })}
                              wsId={wsId ?? ""}
                            />
                          ))}
                        </SidebarMenu>
                      </SortableContext>
                    </DndContext>
                    {visiblePinned.length > PINNED_PREVIEW_LIMIT && (
                      <SidebarMenuButton
                        size="sm"
                        aria-expanded={pinsExpanded}
                        className="mt-0.5 pl-7 text-muted-foreground"
                        onClick={() => setExpandedPinsWorkspaceId(pinsExpanded ? null : wsId ?? null)}
                      >
                        <span>
                          {pinsExpanded
                            ? t(($) => $.sidebar.show_fewer_pins)
                            : t(($) => $.sidebar.show_more_pins, { count: visiblePinned.length - PINNED_PREVIEW_LIMIT })}
                        </span>
                      </SidebarMenuButton>
                    )}
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )}

          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.work_group)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {workNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isActive = !isActivePinnedRoute && isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className={NAV_ITEM_CLASS_NAME}
                      >
                        <Icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.ai_team_group)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {aiTeamNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className={NAV_ITEM_CLASS_NAME}
                      >
                        <Icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2">
          <SidebarMenu className="gap-0.5">
            {utilityNav.map((item) => {
              const href = p[item.key]();
              const Icon = routeIconForPath(href);
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={isNavActive(pathname, href)}
                    render={<AppLink href={href} />}
                    className={NAV_ITEM_CLASS_NAME}
                  >
                    <Icon />
                    <span>{t(($) => $.nav[item.labelKey])}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
          {/* Discord fills the strip while visible; once dismissed, help
              aligns with the navigation icons above. */}
          <div className="flex items-center gap-1">
            <JoinDiscordCard />
            <HelpLauncher />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      </>
  );
}
