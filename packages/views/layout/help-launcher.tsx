"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  Download,
  History,
  MessageCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useModalStore } from "@multica/core/modals";
import { useConfigStore } from "@multica/core/config";
import { isDesktopShell } from "../platform/local-directory";
import { DISCORD_URL, DiscordIcon } from "./discord";
import { useT } from "../i18n";
import { docsLocalePrefix } from "../common/docs-locale";

const DOCS_URL = "https://multica.ai/docs";
const CHANGELOG_URL = "https://multica.ai/changelog";
// Absolute, including on self-hosted deployments: the installers we ship are
// the same binaries either way, and the desktop client can point at a
// self-hosted backend once installed. A self-host-relative /download would
// only serve a copy of this page that still has to reach our release assets.
const DOWNLOAD_URL = "https://multica.ai/download";
const OFFICIAL_LATEST_RELEASE_URL =
  "https://api.github.com/repos/multica-ai/multica/releases/latest";

/** Public GitHub latest release tag for multica-ai/multica. Best-effort. */
export async function fetchOfficialLatestVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(OFFICIAL_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      data &&
      typeof data === "object" &&
      "tag_name" in data &&
      typeof (data as { tag_name: unknown }).tag_name === "string"
    ) {
      const tag = (data as { tag_name: string }).tag_name.trim();
      return tag || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function HelpLauncher() {
  const { t, i18n } = useT("layout");
  const serverVersion = useConfigStore((state) => state.serverVersion);
  const upstreamBaseVersion = useConfigStore((state) => state.upstreamBaseVersion);
  const [officialLatest, setOfficialLatest] = useState<string | null>(null);
  // Web-only: offering "download the desktop app" inside the desktop app is
  // nonsense, and this sidebar is shared — apps/desktop renders the same
  // AppSidebar as the web dashboard, so the entry has to be gated here.
  //
  // No `mounted` deferral (cf. browser-notification-setting.tsx): the desktop
  // renderer is a locally-bundled SPA with no SSR pass, and on web
  // `isDesktopShell()` is false both on the server and after hydration. The
  // markup matches either way, so the link can ship in the SSR payload instead
  // of popping in a frame late.
  const desktop = isDesktopShell();

  useEffect(() => {
    // Only self-hosted Help rows show version info; skip the GitHub call when
    // there is nothing to annotate.
    if (!serverVersion && !upstreamBaseVersion) return;
    let cancelled = false;
    void fetchOfficialLatestVersion().then((tag) => {
      if (!cancelled) setOfficialLatest(tag);
    });
    return () => {
      cancelled = true;
    };
  }, [serverVersion, upstreamBaseVersion]);

  const showVersionRow = !!serverVersion || !!upstreamBaseVersion;

  let officialLine: string | null = null;
  if (upstreamBaseVersion && officialLatest) {
    officialLine = t(($) => $.help.official_base_with_latest, {
      base: upstreamBaseVersion,
      latest: officialLatest,
    });
  } else if (upstreamBaseVersion) {
    officialLine = t(($) => $.help.official_base_only, {
      base: upstreamBaseVersion,
    });
  } else if (officialLatest) {
    officialLine = t(($) => $.help.official_latest_only, {
      latest: officialLatest,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t(($) => $.help.trigger)}
        title={t(($) => $.help.trigger)}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <CircleHelp className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="min-w-40 max-w-72"
      >
        {!desktop && (
          <>
            <DropdownMenuItem
              render={
                <a
                  href={DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Download className="h-3.5 w-3.5" />
              {t(($) => $.help.download_desktop)}
              <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          render={
            <a
              href={`${DOCS_URL}${docsLocalePrefix(i18n.language)}`}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t(($) => $.help.docs)}
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <History className="h-3.5 w-3.5" />
          {t(($) => $.help.changelog)}
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <DiscordIcon className="h-3.5 w-3.5" />
          {t(($) => $.help.discord)}
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => useModalStore.getState().open("feedback")}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {t(($) => $.help.feedback)}
        </DropdownMenuItem>
        {showVersionRow && (
          <>
            <DropdownMenuSeparator />
            {/* DropdownMenuLabel renders Base UI's Menu.GroupLabel, which reads
                a Menu.Group context and throws if it has no Group ancestor. It
                must always be wrapped in a DropdownMenuGroup — without it the
                Help menu crashes the whole app on open (no error boundary sits
                above the sidebar). */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal break-words space-y-0.5">
                {serverVersion && (
                  <div>{t(($) => $.help.server_version, { version: serverVersion })}</div>
                )}
                {officialLine && <div>{officialLine}</div>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
