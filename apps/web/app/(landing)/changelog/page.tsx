import type { Metadata } from "next";
import { ChangelogPageClient } from "@/features/landing/components/changelog-page-client";

export const metadata: Metadata = {
  title: "更新日志",
  description:
    "See what's new in Multica — latest features, improvements, and fixes.",
  openGraph: {
    title: "更新日志",
    description: "Latest updates and releases from Multica.",
    url: "/changelog",
  },
  alternates: {
    canonical: "/changelog",
  },
};

export default function ChangelogPage() {
  return <ChangelogPageClient />;
}
