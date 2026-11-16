// Task 8b: `tailwind-merge` clasifica `text-fs*` (nuestra escala tipográfica) como
// COLOR, no como font-size — dos "colores" chocan y uno se cae en silencio. Ya había
// daño vivo en dos migraciones aprobadas (TabBar.tsx:85, Sidebar.tsx:377) antes de que
// alguien lo notara, porque ningún gate medía el className final contra el fuente.
//
// Este archivo prueba tres puntas:
//   1. que el bug es real contra un `twMerge` SIN extender (el paquete `tailwind-merge`
//      tal cual, no el `cn` del proyecto) — para dejar registrado que no es una lectura
//      equivocada de otra cosa.
//   2. que el `cn` de `@/lib/utils` (con el fix) sobrevive las dos direcciones (tamaño
//      primero, color primero) sin perder el comportamiento que sí se quiere conservar:
//      un tamaño pisa a otro tamaño.
//   3. que el paquete `"cn"` (el que usan los componentes stock de shadcn en
//      `src/components/ui/`) da EXACTAMENTE lo mismo que `@/lib/utils` — lo que prueba
//      que el alias de módulo está puesto en el config de tests, no sólo en la app.
import { describe, it, expect } from 'vitest'
import { twMerge as twMergeSinExtender } from 'tailwind-merge'
import { cn } from '@/lib/utils'
import { cn as cnPkg } from 'cn'

const ESCALA = ['text-fs-2xs', 'text-fs-xs', 'text-fs-sm', 'text-fs', 'text-fs-lg', 'text-fs-xl', 'text-fs-2xl']

describe('el bug es real: twMerge sin extender se come text-fs*', () => {
  it('tamaño primero, color después — el tamaño desaparece', () => {
    expect(twMergeSinExtender('text-fs', 'text-muted-foreground')).toBe('text-muted-foreground')
    expect(twMergeSinExtender('text-fs-sm', 'text-destructive')).toBe('text-destructive')
  })

  it('color primero, tamaño después — el COLOR es el que desaparece', () => {
    expect(twMergeSinExtender('text-muted-foreground', 'text-fs')).toBe('text-fs')
    expect(twMergeSinExtender('text-destructive', 'text-fs-sm')).toBe('text-fs-sm')
  })

  it('la escala ESTÁNDAR de Tailwind (text-sm) no tiene este problema — sólo la nuestra', () => {
    expect(twMergeSinExtender('text-sm', 'text-destructive')).toBe('text-sm text-destructive')
  })
})

describe('cn() de @/lib/utils — con el fix, text-fs* deja de competir con el color', () => {
  it.each(ESCALA)('%s + un color de texto: sobreviven los dos, tamaño primero', (fs) => {
    const resultado = cn(fs, 'text-muted-foreground')
    expect(resultado).toContain(fs)
    expect(resultado).toContain('text-muted-foreground')
  })

  it.each(ESCALA)('%s + un color de texto: sobreviven los dos, color primero', (fs) => {
    const resultado = cn('text-destructive', fs)
    expect(resultado).toContain(fs)
    expect(resultado).toContain('text-destructive')
  })

  it('la escala estándar de Tailwind (text-sm) sigue sin problema con el fix puesto', () => {
    expect(cn('text-sm', 'text-destructive')).toBe('text-sm text-destructive')
  })

  it('DOS tamaños siguen resolviendo al último — no queremos que el fix vuelva esto aditivo', () => {
    expect(cn('text-fs-sm', 'text-fs-lg')).toBe('text-fs-lg')
    expect(cn('text-fs-lg', 'text-fs-sm')).toBe('text-fs-sm')
  })

  it('un text-fs-* y la escala estándar (text-sm) también resuelven al último — son el mismo grupo', () => {
    expect(cn('text-sm', 'text-fs-lg')).toBe('text-fs-lg')
    expect(cn('text-fs-lg', 'text-sm')).toBe('text-sm')
  })

  it('los dos casos vivos de la review: TabBar.tsx:85 y Sidebar.tsx:377', () => {
    // TabBar.tsx:85 — perdía text-fs-sm contra text-muted-foreground.
    expect(cn('tab group border-t border-x rounded-t-md text-fs-sm text-muted-foreground'))
      .toBe('tab group border-t border-x rounded-t-md text-fs-sm text-muted-foreground')

    // Sidebar.tsx:377 — perdía text-fs contra las clases del segundo argumento de cn().
    expect(cn('w-full border-none rounded-md py-2 text-fs font-semibold', 'bg-popover text-muted-foreground cursor-default'))
      .toContain('text-fs')
  })
})

describe('el alias de módulo "cn" -> @/lib/utils (vitest.config.ts)', () => {
  it.each(ESCALA)('%s + un color vía el paquete "cn": sobreviven los dos', (fs) => {
    const resultado = cnPkg(fs, 'text-destructive')
    expect(resultado).toContain(fs)
    expect(resultado).toContain('text-destructive')
  })

  it('el paquete "cn" y @/lib/utils dan exactamente lo mismo — es la misma implementación', () => {
    expect(cnPkg('text-fs-sm', 'text-destructive')).toBe(cn('text-fs-sm', 'text-destructive'))
    expect(cnPkg('tab text-fs-sm text-muted-foreground')).toBe(cn('tab text-fs-sm text-muted-foreground'))
  })
})
