// src/components/MemoriesWelcome.tsx
// Task 7 (2026-10-19, spec §4/§5): lo primero que ve quien abre Memories por primera
// vez (y lo que "How Memories works" vuelve a mostrar a pedido). Una escena concreta
// de dos agentes dejando y leyendo una memoria, los cuatro alcances en los que importa,
// y la salida a la acción: el tour de 5 pasos o seguir solo.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  onTour: () => void
  onSkip: () => void
}

const USOS: { titulo: string; texto: string }[] = [
  { titulo: 'Just for you', texto: 'works the moment you open a terminal; nothing leaves this machine.' },
  { titulo: 'On all your machines', texto: 'pick up on the laptop what you started on the desktop.' },
  { titulo: 'With your team', texto: "share a project and everyone's agents start with what the others decided." },
  { titulo: 'Outside Nest', texto: 'any editor or terminal, with npx @nestmux/memory.' },
]

export default function MemoriesWelcome({ onTour, onSkip }: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Your agents stop starting from zero</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-background p-3 font-mono text-fs-sm">
            <div className="text-muted-foreground">claude · monday</div>
            <div>● memory_save  decision: &quot;search matches loose terms, not the exact phrase&quot;</div>
          </div>
          <div className="rounded-md border border-border bg-background p-3 font-mono text-fs-sm">
            <div className="text-muted-foreground">codex · tuesday</div>
            <div>● memory_context  1 memory about search — reading it before starting</div>
          </div>
        </div>

        <ul className="flex flex-col gap-1.5 text-fs-sm text-foreground">
          {USOS.map((uso) => (
            <li key={uso.titulo}>
              <strong className="font-semibold">{uso.titulo}</strong> — {uso.texto}
            </li>
          ))}
        </ul>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onSkip}>
            Skip — I&apos;ll look on my own
          </Button>
          <Button onClick={onTour}>Show me around · 5 steps</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
