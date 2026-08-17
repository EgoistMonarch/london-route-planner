import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "London Resilient Route Planner",
  description: "An adaptive London journey agent that recovers from live-data failures without starting over.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
