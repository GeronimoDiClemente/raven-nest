// El marco de una sección de la pestaña Settings: título, bajada de una línea y las filas.
import type { ReactNode } from 'react'

export interface SettingsSectionProps { titulo: string; bajada?: ReactNode; children: ReactNode }

export default function SettingsSection({ titulo, bajada, children }: SettingsSectionProps) {
  return (
    <section aria-label={titulo} className="mx-auto flex w-full max-w-[720px] flex-col p-6">
      <h2 className="m-0 text-fs-lg font-semibold text-foreground">{titulo}</h2>
      {bajada && <p className="m-0 mt-1 text-fs-sm text-muted-foreground">{bajada}</p>}
      <div className="mt-3 flex flex-col">{children}</div>
    </section>
  )
}
