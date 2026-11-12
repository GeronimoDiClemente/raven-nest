// Nombre de la rama de un worker: `nest/<slug(label)>-<6 primeros del workerId>`.
// Tiene que pasar la regex de ramas existente: ^[a-zA-Z0-9._/\-]+$

export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return s || 'worker'
}

export function branchName(label: string, workerId: string): string {
  return `nest/${slugify(label)}-${workerId.slice(0, 6)}`
}
