import * as React from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      // La regla `kbd` sin capa de global.css le gana a las utilidades: estas con `!` la vencen.
      className={cn(
        "inline-flex items-center rounded-sm border border-border-strong! px-[5px]! py-0! font-mono [font-size:10.5px]! [font-family:var(--font-mono)]! [border-radius:calc(var(--radius)-2px)]! text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
