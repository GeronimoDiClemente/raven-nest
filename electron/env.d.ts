// Tipos de las variables de entorno que electron-vite inyecta en el proceso
// main a través de import.meta.env (prefijo MAIN_VITE_*).
interface ImportMetaEnv {
  readonly MAIN_VITE_GITHUB_CLIENT_ID: string
  readonly MAIN_VITE_GITLAB_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
