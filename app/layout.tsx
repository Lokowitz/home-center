import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { themeNames } from "@/lib/themes";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "HomeCenter",
  description: "Track and manage your homes and vehicles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        {/* Each theme name lands on <html> as both a class (so "dark" is .dark) and
            data-theme (so "ledger" is [data-theme="ledger"]); see lib/themes.ts. */}
        <ThemeProvider attribute={["class", "data-theme"]} themes={themeNames} defaultTheme="system" enableSystem>
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
