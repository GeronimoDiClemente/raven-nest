import * as React from "react"
import { cn } from "@/lib/utils"

type SegmentedProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  options: { value: string; label: React.ReactNode }[]
  value: string
  onValueChange: (value: string) => void
  "aria-label": string
}

function Segmented({ options, value, onValueChange, className, ...props }: SegmentedProps) {
  return (
    <div
      role="group"
      className={cn("inline-flex gap-0.5 rounded-md border border-border p-0.5 text-sm", className)}
      {...props}
    >
      {options.map((o) => {
        const pressed = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "rounded-sm px-3 py-1 text-muted-foreground hover:bg-sidebar-row-hover",
              pressed && "bg-sidebar-row-selected text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
