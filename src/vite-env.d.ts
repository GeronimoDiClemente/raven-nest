/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string
  export default src
}

// Electron expone -webkit-app-region para arrastrar la ventana desde
// elementos de la UI. React.CSSProperties no lo tipa, así que lo añadimos.
import 'react'
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
