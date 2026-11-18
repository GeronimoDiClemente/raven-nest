import * as React from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      // La regla `kbd` sin capa de global.css le gana a las utilidades: estas con `!` la vencen.
      className={cn(
        "inline-flex items-center rounded-sm border border-border px-1.5 font-mono text-xs [font-family:var(--font-mono)]! [border-radius:calc(var(--radius)-2px)]! px-1.5! text-xs! text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
