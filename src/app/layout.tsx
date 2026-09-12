import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yap2Graph — Intent-aware research & memory",
  description:
    "Turn one week of working memory into intent-aware standups, manager updates, and technical blog posts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
