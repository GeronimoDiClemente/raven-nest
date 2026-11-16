// Editor & graph (spec §5): las preferencias del editor de notas y del grafo. Presentación
// pura: las prefs entran y salen por props (el workspace las guarda con useMemoryPrefs).
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SettingRow from './SettingRow'
import {
  TAMANOS_DE_LETRA, type EtiquetasDelGrafo, type MemoryPrefs, type PrefsDelEditor, type PrefsDelGrafo,
} from '../../../lib/memory-prefs'

export interface EditorGraphSectionProps {
  prefs: MemoryPrefs
  /** true mientras las prefs no cargaron: un cambio ahí lo pisaría la carga. */
  disabled?: boolean
  onChange: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void
  onResetGraph: () => void
}

const ETIQUETAS: ReadonlyArray<{ id: EtiquetasDelGrafo; texto: string }> = [
  { id: 'always', texto: 'Always' },
  { id: 'zoom', texto: 'When zoomed in' },
  { id: 'hover', texto: 'On hover' },
]

function Subtitulo({ children }: { children: string }) {
  return <h3 className="m-0 mt-4 text-fs-xs font-medium uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h3>
}

export default function EditorGraphSection({ prefs, disabled = false, onChange, onResetGraph }: EditorGraphSectionProps) {
  const editor = (patch: Partial<PrefsDelEditor>) => onChange((p) => ({ ...p, editor: { ...p.editor, ...patch } }))
  const grafo = (patch: Partial<PrefsDelGrafo>) => onChange((p) => ({ ...p, graph: { ...p.graph, ...patch } }))
  const interruptor = (id: string, checked: boolean, alCambiar: (v: boolean) => void) => (
    <Switch aria-labelledby={id} checked={checked} disabled={disabled} onCheckedChange={alCambiar} />
  )

  return (
    <>
      <Subtitulo>Editor</Subtitulo>
      <SettingRow id="pref-live-preview" nombre="Live preview" descripcion="Hide Markdown syntax except on the line you're editing."
        control={interruptor('pref-live-preview', prefs.editor.livePreview, (v) => editor({ livePreview: v }))} />
      <SettingRow id="pref-readable-width" nombre="Readable line width" descripcion="Cap note width so long lines are easy to read."
        control={interruptor('pref-readable-width', prefs.editor.readableWidth, (v) => editor({ readableWidth: v }))} />
      <SettingRow id="pref-spellcheck" nombre="Spellcheck" descripcion="Underline misspelled words while you write."
        control={interruptor('pref-spellcheck', prefs.editor.spellcheck, (v) => editor({ spellcheck: v }))} />
      <SettingRow nombre="Font size" descripcion="Size of the note text."
        control={
          <Select value={String(prefs.editor.fontSize)} disabled={disabled} onValueChange={(v) => editor({ fontSize: Number(v) })}>
            <SelectTrigger size="sm" aria-label="Font size"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAMANOS_DE_LETRA.map((n) => <SelectItem key={n} value={String(n)}>{n} px</SelectItem>)}
            </SelectContent>
          </Select>
        } />

      <Subtitulo>Graph</Subtitulo>
      <SettingRow id="pref-remember" nombre="Remember graph filters" descripcion="Keep orphans, guessed links, colours and forces as you left them."
        control={interruptor('pref-remember', prefs.graph.remember, (v) => grafo(v ? { remember: true } : { remember: false, filtros: undefined }))} />
      <SettingRow nombre="Labels" descripcion="When node names show on the graph."
        control={
          <Select value={prefs.graph.labels} disabled={disabled} onValueChange={(v) => grafo({ labels: v as EtiquetasDelGrafo })}>
            <SelectTrigger size="sm" aria-label="Labels"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ETIQUETAS.map((e) => <SelectItem key={e.id} value={e.id}>{e.texto}</SelectItem>)}
            </SelectContent>
          </Select>
        } />
      <SettingRow id="pref-animate" nombre="Animate graph" descripcion="Turn off on slow machines: nodes appear already in place."
        control={interruptor('pref-animate', prefs.graph.animate, (v) => grafo({ animate: v }))} />
      <SettingRow nombre="Reset graph to defaults"
        control={<Button variant="outline" size="sm" disabled={disabled} onClick={onResetGraph}>Reset</Button>} />
    </>
  )
}
