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
      // El renderer se estaba shippeando SIN minificar: 80.637 lineas en el chunk
      // principal de una release. electron-vite 3.1.0 no lo prende solo para el renderer
      // y el config nunca lo dijo, asi que nadie lo noto.
      //
      // Medido el 2026-09-11 en este arbol: los assets del renderer pasan de 35.1 MB a
      // 19.8 MB (-44%), y el chunk que la app carga al ARRANCAR de 3519.1 a 1798.0 KB
      // crudos (-49%), 690.0 -> 483.3 KB gzip. Es la mitad del tiempo de parseo en el
      // arranque, en una app que ademas corre terminales.
      //
      // Verificado: las 17 e2e pasan contra el build minificado. El riesgo tipico de
      // minificar --codigo que depende de Function.name o constructor.name-- no aplica
      // aca: los `.name` del repo son todos propiedades de datos (nombres de tema, de
      // opcion de config, de columna SQLite), que el minificador no toca.
      minify: 'esbuild',
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
