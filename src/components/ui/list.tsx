import * as React from "react"
import { cn } from "@/lib/utils"

function List({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-md border border-border bg-card text-sm text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

type ListRowProps = Omit<React.ComponentProps<"div">, "onClick"> & {
  selected?: boolean
  onClick?: React.MouseEventHandler<HTMLElement>
}

function ListRow({ selected, onClick, className, ...props }: ListRowProps) {
  const classes = cn(
    "flex w-full items-center gap-2 px-3 py-2 text-left",
    selected && "bg-sidebar-row-active",
    onClick && "cursor-pointer hover:bg-sidebar-row-hover",
    className
  )
  const dataSelected = selected ? "true" : undefined
  if (onClick) {
    return (
      <button
        type="button"
        data-selected={dataSelected}
        onClick={onClick}
        className={classes}
        {...(props as React.ComponentProps<"button">)}
      />
    )
  }
  return <div data-selected={dataSelected} className={classes} {...props} />
}

export { List, ListRow }
