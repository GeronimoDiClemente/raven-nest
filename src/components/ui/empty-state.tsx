import * as React from "react"
import { cn } from "@/lib/utils"

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center text-sm",
        className
      )}
      {...props}
    >
      <div className="font-medium text-foreground">{title}</div>
      {description != null && <div className="text-muted-foreground">{description}</div>}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  )
}

export { EmptyState }
