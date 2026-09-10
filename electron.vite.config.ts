import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    build: {
      outDir: 'dist-electron',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'electron/main.ts'),
          // Standalone stdio MCP shim — run outside Electron's normal window process via
          // ELECTRON_RUN_AS_NODE=1 (see docs/nest-memory-architecture.md §1.1). Built as
          // its own entry so it ships as a small, independently invokable script rather
          // than being bundled into main.js.
          'memory-mcp': resolve(__dirname, 'electron/memory-mcp/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    resolve: {
      // shadcn genera imports con `@/`. Sin este alias, nada de components/ui resuelve.
      // `cn` -> @/lib/utils: los componentes stock (src/components/ui/) importan el
      // paquete "cn" en vez del alias @/lib/utils, y ese paquete no conoce nuestra
      // escala tipográfica (--fs-*) — ver src/lib/utils.ts. Este alias hace que toda la
      // app use una sola implementación de merge, la que sí la conoce.
      alias: { '@': resolve(__dirname, 'src'), cn: resolve(__dirname, 'src/lib/utils.ts') }
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: ['monaco-editor'],
    }
  }
})
