import { useEffect, useState } from 'react'
import type { RecipeDescriptor } from '../types'

/** Read-only list of the event-bus recipes ("when an event happens, do
 *  something") — mirrors electron/integrations/recipes.ts via window.recipes.
 *  No editing here yet; this just surfaces what's already wired to the bus. */
export function RecipesView() {
  const [recipes, setRecipes] = useState<RecipeDescriptor[]>([])

  useEffect(() => {
    window.recipes?.list?.().then(setRecipes)
  }, [])

  return (
    <div className="rcp-view">
      <div className="rcp-head">
        <h2 className="rcp-title">Recipes</h2>
        <p className="rcp-lead">Reactive rules — when an event happens, do something. These run on the event bus.</p>
      </div>

      {recipes.length === 0 ? (
        <div className="rcp-empty">No recipes yet.</div>
      ) : (
        <div className="rcp-list">
          {recipes.map((r) => (
            <div key={r.id} className="rcp-row">
              <span className="rcp-when">{r.when}</span>
              <span className="rcp-arrow">→</span>
              <div className="rcp-cmds">
                {r.commands.map((cmd, i) => (
                  <span key={i} className="rcp-cmd">{cmd}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
