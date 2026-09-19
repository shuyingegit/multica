import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "开始使用",
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
