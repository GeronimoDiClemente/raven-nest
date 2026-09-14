/**
 * El catalogo de temas de terminal.
 *
 * Nest tenia UN tema, escrito a mano adentro de `useXterm.ts`: dieciseis colores que eligio
 * alguien una vez, sin forma de cambiarlos ni de importar los que el usuario ya tiene
 * configurados en su terminal de siempre.
 *
 * **Las paletas NO estan escritas de memoria.** Salen de `mbadolato/iTerm2-Color-Schemes`,
 * que es la coleccion de la que Ghostty y Warp toman las suyas, descargadas el 2026-09-13.
 * Copiarlas a ojo produciria temas que se parecen al que el usuario conoce sin ser ese — que
 * es peor que no ofrecerlos, porque el punto de importar un tema es reconocerlo.
 *
 * El orden del array `ansi` es el del estandar: los ocho normales primero (negro, rojo,
 * verde, amarillo, azul, magenta, cyan, blanco) y los ocho brillantes despues.
 */

export interface TemaDeTerminal {
  /** Slug estable. Es lo que se guarda en las preferencias, no el nombre. */
  id: string
  nombre: string
  background: string
  foreground: string
  cursor: string
  selection: string
  /** Los 16 colores ANSI, en orden estandar. */
  ansi: string[]
}

/**
 * El tema propio, con el contraste arreglado.
 *
 * `brightBlack` —el gris con el que se pintan los comentarios— estaba en `#4c4c4c`, que
 * contra el fondo negro da **2.45:1**. El repo corre un guard de 3:1 sobre la interfaz
 * (`e2e/04-contraste.spec.ts`), asi que nuestro propio terminal no pasaba la vara que le
 * exigimos a todo lo demas. Medido el 2026-09-13 contra los trece temas del catalogo: era el
 * segundo peor de la lista.
 *
 * `#646464` da **3.55:1**: margen real sobre el minimo, y sigue estando muy por debajo del
 * texto normal (17.14:1), asi que la jerarquia —un comentario se lee como secundario— no se
 * pierde. `#5c5c5c` ya pasaba con 3.14, pero raspando: un tema no deberia quedar a
 * 0.14 de fallar su propio chequeo.
 *
 * `black` (`#1a1a1a`) se deja como esta a proposito: el ANSI negro es un color de FONDO, no
 * de texto. Medirlo contra el fondo y "arreglarlo" lo volveria un gris que no sirve para lo
 * unico que hace.
 */
export const TEMA_NEST: TemaDeTerminal = {
  id: 'nest',
  nombre: 'Nest',
  background: '#000000',
  foreground: '#e8e8e8',
  cursor: '#0066FF',
  selection: '#0066FF33',
  ansi: [
    '#1a1a1a', '#ff5f57', '#28cd41', '#ffbd2e', '#0066FF', '#b48ead', '#88c0d0', '#e8e8e8',
    '#646464', '#ff6e67', '#5af78e', '#f4f99d', '#4d9eff', '#caa9fa', '#9aedfe', '#ffffff',
  ],
}

export const TEMAS: TemaDeTerminal[] = [
  TEMA_NEST,
  {
    id: 'dracula',
    nombre: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selection: '#44475a',
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  },
  {
    id: 'nord',
    nombre: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#eceff4',
    selection: '#eceff4',
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#596377', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  },
  {
    id: 'gruvbox-dark',
    nombre: 'Gruvbox Dark',
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selection: '#665c54',
    ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  },
  {
    id: 'catppuccin-mocha',
    nombre: 'Catppuccin Mocha',
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selection: '#f5e0dc',
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de', '#585b70', '#f7aec2', '#c2ecbf', '#fcd682', '#aeccfc', '#f398da', '#b1eae1', '#a6adc8'],
  },
  {
    id: 'tokyonight',
    nombre: 'TokyoNight',
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selection: '#33467c',
    ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6', '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
  },
  {
    id: 'one-half-dark',
    nombre: 'One Half Dark',
    background: '#282c34',
    foreground: '#dcdfe4',
    cursor: '#a3b3cc',
    selection: '#474e5d',
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4', '#5d677a', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4'],
  },
  {
    id: 'solarized-dark-higher-contrast',
    nombre: 'Solarized Dark Higher Contrast',
    background: '#001e27',
    foreground: '#9cc2c3',
    cursor: '#f34b00',
    selection: '#003748',
    ansi: ['#002831', '#d11c24', '#6cbe6c', '#a57706', '#2176c7', '#c61c6f', '#259286', '#eae3cb', '#006488', '#f5163b', '#51ef84', '#b27e28', '#178ec8', '#e24d8e', '#00b39e', '#fcf4dc'],
  },
  {
    id: 'rose-pine',
    nombre: 'Rose Pine',
    background: '#191724',
    foreground: '#e0def4',
    cursor: '#e0def4',
    selection: '#403d52',
    ansi: ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4', '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'],
  },
  {
    id: 'everforest-dark-hard',
    nombre: 'Everforest Dark Hard',
    background: '#1e2326',
    foreground: '#d3c6aa',
    cursor: '#e69875',
    selection: '#4c3743',
    ansi: ['#7a8478', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#f2efdf', '#a6b0a0', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#fffbef'],
  },
  {
    id: 'github-dark',
    nombre: 'GitHub Dark',
    background: '#101216',
    foreground: '#8b949e',
    cursor: '#c9d1d9',
    selection: '#3b5070',
    ansi: ['#000000', '#f78166', '#56d364', '#e3b341', '#6ca4f8', '#db61a2', '#2b7489', '#ffffff', '#4d4d4d', '#f78166', '#56d364', '#e3b341', '#6ca4f8', '#db61a2', '#2b7489', '#ffffff'],
  },
  {
    id: 'ayu-mirage',
    nombre: 'Ayu Mirage',
    background: '#1f2430',
    foreground: '#cccac2',
    cursor: '#ffcc66',
    selection: '#409fff',
    ansi: ['#171b24', '#ed8274', '#87d96c', '#facc6e', '#6dcbfa', '#dabafa', '#90e1c6', '#c7c7c7', '#686868', '#f28779', '#d5ff80', '#ffd173', '#73d0ff', '#dfbfff', '#95e6cb', '#ffffff'],
  },
  {
    id: 'monokai-remastered',
    nombre: 'Monokai Remastered',
    background: '#0c0c0c',
    foreground: '#d9d9d9',
    cursor: '#fc971f',
    selection: '#343434',
    ansi: ['#1a1a1a', '#f4005f', '#98e024', '#fd971f', '#9d65ff', '#f4005f', '#58d1eb', '#c4c5b5', '#625e4c', '#f4005f', '#98e024', '#e0d561', '#9d65ff', '#f4005f', '#58d1eb', '#f6f6ef'],
  },
]

/**
 * El tema con ese id, buscando primero en los IMPORTADOS.
 *
 * Los del usuario ganan sobre los nuestros a proposito: si alguien importa su propio
 * "Dracula" —retocado a su gusto— y le queda el mismo id que el del catalogo, el que quiere
 * ver es el suyo. Es el unico caso donde los dos pueden chocar, y la respuesta obvia es que
 * mande el que el usuario trajo.
 *
 * Un id que no existe cae al tema propio en vez de devolver undefined: un tema borrado no
 * puede dejar la terminal sin colores.
 */
export function temaPorId(
  id: string | null | undefined,
  importados: TemaDeTerminal[] = [],
): TemaDeTerminal {
  if (!id) return TEMA_NEST
  return importados.find((t) => t.id === id) ?? TEMAS.find((t) => t.id === id) ?? TEMA_NEST
}

// ── Contraste ──────────────────────────────────────────────────────────────────

/** Luminancia relativa de WCAG. */
function luminancia(hex: string): number {
  const h = hex.replace('#', '')
  const canal = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4)
}

/** La razon de contraste entre dos colores, 1..21. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  const alto = Math.max(la, lb)
  const bajo = Math.min(la, lb)
  return (alto + 0.05) / (bajo + 0.05)
}

/** El piso que el repo ya le exige a su propia interfaz (`e2e/04-contraste.spec.ts`). */
export const CONTRASTE_MINIMO = 3

/**
 * El peor contraste de una paleta contra su propio fondo, mirando los colores con los que se
 * escribe TEXTO.
 *
 * El ANSI negro (indice 0) queda afuera: es un color de fondo, y medirlo contra el fondo
 * daria siempre un numero malo que no significa nada.
 */
export function peorContraste(tema: TemaDeTerminal): number {
  const candidatos = [tema.foreground, ...tema.ansi.slice(1)]
  return candidatos.reduce((peor, c) => Math.min(peor, contraste(c, tema.background)), Infinity)
}

/**
 * Sube un color hasta que alcance el minimo contra el fondo, **conservando su tono**.
 *
 * Es lo que vuelve ofrecible el catalogo y no un adorno. Medido el 2026-09-13: ocho de los
 * trece temas tienen algun color por debajo de 3:1 contra su propio fondo — TokyoNight deja
 * los comentarios en 1.91. Sin esto, un usuario importa su tema de siempre, no lee la mitad,
 * y le echa la culpa a Nest en vez de al tema.
 *
 * **No es "arreglar" el tema.** El gris de comentario esta atenuado a proposito: esa es su
 * funcion. Por eso el ajuste es OPCIONAL y por eso levanta lo justo hasta el piso en vez de
 * normalizar todo — un tema ajustado tiene que seguir pareciendose al original.
 *
 * Se mueve sobre la luminosidad en HSL, no sobre cada canal RGB: subir los canales por igual
 * lava el color hacia el blanco y un rojo tenue termina rosa.
 */
export function ajustarContraste(tema: TemaDeTerminal, minimo = CONTRASTE_MINIMO): TemaDeTerminal {
  const subir = (color: string): string => {
    if (contraste(color, tema.background) >= minimo) return color
    const fondoClaro = luminancia(tema.background) > 0.5
    let mejor = color
    // 40 pasos de 2.5% de luminosidad: suficiente para cruzar el umbral desde cualquier
    // punto, y el bucle corta apenas lo cruza en vez de recorrerlos todos.
    for (let paso = 1; paso <= 40; paso++) {
      const candidato = moverLuminosidad(color, fondoClaro ? -paso * 0.025 : paso * 0.025)
      mejor = candidato
      if (contraste(candidato, tema.background) >= minimo) break
    }
    return mejor
  }
  return {
    ...tema,
    foreground: subir(tema.foreground),
    // El indice 0 (negro ANSI) no se toca: ver `peorContraste`.
    ansi: tema.ansi.map((c, i) => (i === 0 ? c : subir(c))),
  }
}

/** Mueve la luminosidad HSL de un color, dejando tono y saturacion donde estaban. */
function moverLuminosidad(hex: string, delta: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let luz = (max + min) / 2
  const d = max - min
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * luz - 1))
  let tono = 0
  if (d !== 0) {
    if (max === r) tono = ((g - b) / d) % 6
    else if (max === g) tono = (b - r) / d + 2
    else tono = (r - g) / d + 4
    tono *= 60
    if (tono < 0) tono += 360
  }
  luz = Math.min(1, Math.max(0, luz + delta))

  const c = (1 - Math.abs(2 * luz - 1)) * sat
  const x = c * (1 - Math.abs(((tono / 60) % 2) - 1))
  const m = luz - c / 2
  const [r2, g2, b2] =
    tono < 60 ? [c, x, 0] : tono < 120 ? [x, c, 0] : tono < 180 ? [0, c, x]
    : tono < 240 ? [0, x, c] : tono < 300 ? [x, 0, c] : [c, 0, x]
  const bytes = [r2, g2, b2].map((v) => Math.round((v + m) * 255))
  return '#' + bytes.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** La forma que espera xterm.js. */
export function aXterm(tema: TemaDeTerminal): Record<string, string> {
  const [black, red, green, yellow, blue, magenta, cyan, white,
         brightBlack, brightRed, brightGreen, brightYellow,
         brightBlue, brightMagenta, brightCyan, brightWhite] = tema.ansi
  return {
    background: tema.background,
    foreground: tema.foreground,
    cursor: tema.cursor,
    cursorAccent: tema.background,
    selectionBackground: tema.selection,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow,
    brightBlue, brightMagenta, brightCyan, brightWhite,
  }
}

// ── El color de identidad de un pane ───────────────────────────────────────────

/**
 * Los indices ANSI que sirven como identificador de un pane.
 *
 * Los seis cromaticos y sus brillantes: rojo, verde, amarillo, azul, magenta y cyan. Quedan
 * afuera el negro, el blanco y sus brillantes (0, 7, 8, 15) — son grises, y un gris no
 * identifica nada de un vistazo, que es lo unico que este color tiene que hacer.
 *
 * Son doce, igual que la paleta fija que habia antes: el usuario no pierde opciones.
 */
const CANDIDATOS_DE_IDENTIDAD = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]

/**
 * Cuanta diferencia de color hace falta para que dos muestras sean DOS opciones.
 *
 * 10 en distancia CIE76: por debajo de eso, dos circulitos de 22px uno al lado del otro se
 * leen como el mismo color, y elegir entre ellos es una decision que el usuario no puede
 * tomar mirando.
 */
const DISTANCIA_MINIMA = 10

/** Lab de CIE, para medir diferencia de color como la ve un ojo y no como la ve el RGB. */
function aLab(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const lineal = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = lineal(0); const g = lineal(2); const b = lineal(4)
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x); const fy = f(y); const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Distancia CIE76 entre dos colores. */
export function distanciaDeColor(a: string, b: string): number {
  const [l1, a1, b1] = aLab(a)
  const [l2, a2, b2] = aLab(b)
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
}

/**
 * Los indices que sirven como identificador de un pane EN ESTE TEMA.
 *
 * No son doce fijos. Los candidatos son los seis cromaticos y sus brillantes —quedan afuera
 * negro, blanco y sus brillantes, que son grises y no identifican nada de un vistazo— pero se
 * descarta todo el que se parezca demasiado a uno ya elegido.
 *
 * **Por que no son doce siempre.** Medido sobre los trece temas del catalogo el 2026-09-13:
 * SIETE definen los brillantes identicos a los normales (distancia 0 — TokyoNight, One Half
 * Dark, Rose Pine, GitHub Dark y Monokai entre ellos), y 43 de los 78 pares estan por debajo
 * de 10. O sea que un selector de doce muestras le mostraba al usuario el MISMO color dos
 * veces en la mayoria de los temas, y elegir entre dos circulitos iguales no es elegir.
 *
 * Everforest da doce porque de verdad tiene doce colores distintos; TokyoNight da seis porque
 * de verdad tiene seis. El selector muestra lo que el tema tiene.
 *
 * Los normales van primero: son los colores "de verdad" del tema, y si hay que descartar uno
 * del par, el que sobra es el brillante.
 */
export function indicesDeIdentidad(tema: TemaDeTerminal): number[] {
  const elegidos: number[] = []
  for (const i of CANDIDATOS_DE_IDENTIDAD) {
    const color = tema.ansi[i]
    if (!color) continue
    const parecidoAUnoYaElegido = elegidos.some(
      (j) => distanciaDeColor(color, tema.ansi[j]) < DISTANCIA_MINIMA,
    )
    if (!parecidoAUnoYaElegido) elegidos.push(i)
  }
  return elegidos
}

/**
 * Como se llama cada color de la paleta, para el `title` de cada muestra.
 *
 * Con los doce del tema son seis tonos y sus brillantes, y en muchas paletas el par se parece
 * bastante. Poder pasar el mouse y leer "bright red" en vez de adivinar es la diferencia
 * entre doce opciones y seis que parecen repetidas.
 */
export const NOMBRE_ANSI: Record<number, string> = {
  0: 'black', 1: 'red', 2: 'green', 3: 'yellow', 4: 'blue', 5: 'magenta', 6: 'cyan', 7: 'white',
  8: 'bright black', 9: 'bright red', 10: 'bright green', 11: 'bright yellow',
  12: 'bright blue', 13: 'bright magenta', 14: 'bright cyan', 15: 'bright white',
}

/** El prefijo que marca "este color sale del tema", frente a un hex literal. */
const PREFIJO_ANSI = 'ansi:'

/** El valor a guardar para el color `n` de la paleta del tema activo. */
export function colorDeTema(indiceAnsi: number): string {
  return `${PREFIJO_ANSI}${indiceAnsi}`
}

/**
 * El color real con el que pintar el borde de un pane.
 *
 * Guardar un hex suelto ataba el color al momento en que se eligio: alguien elegia un azul
 * electrico, despues importaba Gruvbox —una paleta tierra— y ese azul quedaba encima
 * desentonando, porque no pertenecia a ninguna parte. Guardar el INDICE hace que el color
 * siga al tema: sigue siendo "el rojo" de ese pane, pero es el rojo DE TU TEMA, y cuando
 * cambias de tema se reasigna solo y sigue armonizando.
 *
 * Los hex literales se siguen respetando: los panes que ya existen los tienen guardados, y un
 * color elegido a mano es una decision del usuario que no nos toca revertir.
 */
export function resolverColorDePane(valor: string | undefined | null, tema: TemaDeTerminal): string {
  if (!valor) return 'transparent'
  if (!valor.startsWith(PREFIJO_ANSI)) return valor
  const crudo = valor.slice(PREFIJO_ANSI.length)
  // `/^\d+$/` y no `Number()`: `Number('')` da 0, asi que un `ansi:` sin indice resolvia al
  // negro ANSI — un borde casi invisible sobre un fondo oscuro, que se lee como "se rompio el
  // color" y no como "no hay color". Apagar es honesto; pintar negro es un bug silencioso.
  if (!/^\d+$/.test(crudo)) return 'transparent'
  const i = Number(crudo)
  return i < tema.ansi.length ? tema.ansi[i] : 'transparent'
}

/** Si un valor guardado es un indice del tema (y no un hex ni `transparent`). */
export function esColorDeTema(valor: string | undefined | null): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_ANSI)
}
