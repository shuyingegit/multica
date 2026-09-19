import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "对话",
};

export default function PublicShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
