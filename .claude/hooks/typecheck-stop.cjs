#!/usr/bin/env node
// typecheck-stop.cjs — Hook "Stop" para Raven Nest.
//
// Corre `tsc -b --noEmit` al terminar cada respuesta de Claude y SOLO bloquea
// si aparecieron errores de tipo NUEVOS respecto a un baseline guardado.
// La deuda de tipos preexistente se ignora, así que no te frena por errores
// que ya estaban. Cuando arreglás deuda, la marca baja sola (ratchet): no
// podés re-introducir un error que ya habías eliminado.
//
// Contrato de hook (Claude Code):
//   exit 0 -> no bloquea (silencioso, salvo mensajes informativos a stderr)
//   exit 2 -> bloquea el Stop y devuelve stderr al agente para que lo arregle

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..', '..');
const baselinePath = path.join(projectDir, '.claude', 'tsc-baseline.json');
const tscBin = path.join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc');

// Anti-loop: si Claude ya está continuando por culpa de este mismo hook, no re-bloquear.
let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  /* sin stdin: seguimos igual */
}
if (payload.stop_hook_active) process.exit(0);

// Si TypeScript no está instalado, no molestar (fail-open).
if (!fs.existsSync(tscBin)) process.exit(0);

// Correr el typecheck de ambos sub-proyectos (node + web vía references).
const res = spawnSync(process.execPath, [tscBin, '-b', '--noEmit'], {
  cwd: projectDir,
  encoding: 'utf8',
  timeout: 120000,
});
const output = `${res.stdout || ''}\n${res.stderr || ''}`;

// Parsear errores con formato: "ruta(linea,col): error TSxxxx: mensaje".
// La firma NO incluye linea/col: así editar el archivo (que mueve las líneas)
// no genera falsos "errores nuevos".
const lineRe = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const errors = new Map(); // firma -> línea cruda (para mostrarla)
for (const line of output.split(/\r?\n/)) {
  const m = line.match(lineRe);
  if (!m) continue;
  const [, file, , , code, msg] = m;
  const sig = `${file.replace(/\\/g, '/')}|${code}|${msg.trim()}`;
  if (!errors.has(sig)) errors.set(sig, line.trim());
}
const currentSigs = [...errors.keys()];

// Cargar baseline si existe.
let baseline = null;
if (fs.existsSync(baselinePath)) {
  try {
    baseline = new Set(JSON.parse(fs.readFileSync(baselinePath, 'utf8')));
  } catch {
    baseline = null;
  }
}

// Primera ejecución: tomamos snapshot de la deuda actual y no bloqueamos.
if (!baseline) {
  fs.writeFileSync(baselinePath, JSON.stringify(currentSigs, null, 2));
  console.error(
    `[typecheck] Baseline creado con ${currentSigs.length} error(es) de tipo preexistente(s). ` +
      `A partir de ahora solo te aviso de errores NUEVOS.`
  );
  process.exit(0);
}

// Errores nuevos = los actuales que no figuran en el baseline.
const nuevos = currentSigs.filter((s) => !baseline.has(s));

if (nuevos.length === 0) {
  // Ratchet: si arreglaste deuda, bajamos la marca para que no pueda volver.
  if (currentSigs.length < baseline.size) {
    fs.writeFileSync(baselinePath, JSON.stringify(currentSigs, null, 2));
  }
  process.exit(0);
}

// Regresión de tipos: bloquear y pedir el arreglo en esta misma sesión.
const detalle = nuevos.map((s) => `  • ${errors.get(s)}`).join('\n');
console.error(
  `⛔ tsc -b --noEmit: introdujiste ${nuevos.length} error(es) de tipo NUEVO(s):\n` +
    `${detalle}\n\n` +
    `Arreglalos antes de terminar. (La deuda de tipos preexistente se ignora vía baseline.)`
);
process.exit(2);
