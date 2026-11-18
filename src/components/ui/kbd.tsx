import * as React from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-sm border border-border px-1.5 font-mono text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
