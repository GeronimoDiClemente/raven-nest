import * as React from "react"
import { cn } from "@/lib/utils"

const tones = {
  ok: "bg-ok-surface text-ok",
  warn: "bg-warn-surface text-warn",
  destructive: "bg-destructive-surface text-destructive",
  info: "bg-info-surface text-info",
  muted: "bg-sidebar-row-active text-muted-foreground",
} as const

type StatusBadgeProps = React.ComponentProps<"span"> & {
  tone: keyof typeof tones
}

function StatusBadge({ tone, className, ...props }: StatusBadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}

export { StatusBadge }
