"use client"

import { useTheme } from "next-themes"
import { isDarkTheme } from "@/lib/themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  // Sonner only knows light and dark; the named themes collapse to whichever their background is.
  const sonnerTheme = isDarkTheme(resolvedTheme) ? "dark" : "light"

  return (
    <Sonner
      theme={sonnerTheme}
      position="top-right"
      closeButton
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Sonner sets its own system font on the toaster; use the theme's.
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      // Every toast is the theme's popover; the kind shows in the icon and a
      // left accent in the theme's colours (no richColors: its fixed green,
      // red and blue ignore the theme).
      toastOptions={{
        classNames: {
          toast: "cn-toast !border-l-4 !shadow-lg",
          title: "!font-medium",
          description: "!text-muted-foreground",
          success: "!border-l-primary [&_[data-icon]]:text-primary",
          info: "!border-l-primary [&_[data-icon]]:text-primary",
          error: "!border-l-destructive [&_[data-icon]]:text-destructive",
          // No theme has a warning colour; amber reads as a warning on every background.
          warning: "!border-l-amber-500 [&_[data-icon]]:text-amber-500",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md",
          cancelButton: "!bg-muted !text-muted-foreground !rounded-md",
          closeButton: "!bg-popover !text-muted-foreground !border-border hover:!text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
