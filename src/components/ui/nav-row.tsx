import * as React from "react"
import { cn } from "@/lib/utils"

type NavRowProps = Omit<React.ComponentProps<"button">, "type"> & {
  selected?: boolean
  icon?: React.ReactNode
  count?: React.ReactNode
  countTone?: "default" | "warn"
}

function NavRow({ selected, icon, count, countTone = "default", children, className, ...props }: NavRowProps) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-row-hover active:bg-sidebar-row-active",
        selected && "bg-sidebar-row-selected text-foreground",
        className
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && (
        <span className={cn("tabular-nums", countTone === "warn" && "text-warn")}>{count}</span>
      )}
    </button>
  )
}

export { NavRow }
