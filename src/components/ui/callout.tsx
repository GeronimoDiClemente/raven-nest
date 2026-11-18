import * as React from "react"
import { cn } from "@/lib/utils"

const tones = {
  warn: "bg-warn-surface border-[color:color-mix(in_srgb,var(--warn)_35%,transparent)]",
  destructive: "bg-destructive-surface border-[color:color-mix(in_srgb,var(--destructive)_35%,transparent)]",
  info: "bg-info-surface border-[color:color-mix(in_srgb,var(--info)_35%,transparent)]",
} as const

type CalloutProps = Omit<React.ComponentProps<"div">, "title"> & {
  tone: keyof typeof tones
  title: React.ReactNode
  action?: React.ReactNode
}

function Callout({ tone, title, action, children, className, ...props }: CalloutProps) {
  return (
    <div
      role="status"
      data-tone={tone}
      className={cn("flex items-center gap-3 rounded-md border px-3.5 py-3 text-fs", tones[tone], className)}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{title}</div>
        {children != null && <div className="text-muted-foreground">{children}</div>}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export { Callout }
