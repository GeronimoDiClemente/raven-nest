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
      className={cn("inline-flex gap-0 overflow-hidden rounded-sm border border-border-strong", className)}
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
              "min-h-[26px] border-none px-2.5 py-1 [font-size:11.5px] text-muted-foreground no-underline hover:bg-sidebar-row-hover",
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
