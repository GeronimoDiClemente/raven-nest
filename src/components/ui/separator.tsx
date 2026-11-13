import * as React from "react"
import { cn } from "cn"
import { Separator as SeparatorPrimitive } from "radix-ui"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        // `data-[orientation=...]`, no `data-horizontal:`. El shorthand de Tailwind v4 para
        // data-attributes genera `[data-horizontal]` — un atributo LLAMADO así — y Radix emite
        // `data-orientation="horizontal"`. O sea que ninguna de las cuatro clases aplicaba: el
        // separador salía con alto 0 y ancho 0. Medido en la barra lateral el 2026-09-11: dejaba
        // los 12px de su margen y no dibujaba la línea, que es lo peor de los dos mundos —
        // parecía un hueco arbitrario en el ritmo de las filas.
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
