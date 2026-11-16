// Arma el `.vsix` sin `vsce`.
//
// Un `.vsix` es un zip con el formato OPC de Microsoft: un manifiesto XML en la raíz, la
// tabla de tipos de contenido, y la extensión adentro de una carpeta `extension/`. `vsce`
// hace eso más validaciones y un `npm install` de producción; acá no hay dependencias que
// instalar —todo está compilado adentro de `dist`— así que armarlo a mano evita sumar una
// herramienta y una descarga a la cadena de build.
//
// Lo que se pierde de `vsce` son sus validaciones. Lo que se gana es que esto corre sin red.
import AdmZip from 'adm-zip'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifiesto = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
const { name, version, publisher, displayName, description } = manifiesto

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const VSIXMANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapar(name)}" Version="${escapar(version)}" Publisher="${escapar(publisher)}" />
    <DisplayName>${escapar(displayName)}</DisplayName>
    <Description xml:space="preserve">${escapar(description)}</Description>
    <Tags>memory,mcp,nest</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`

// Sólo los tipos que este paquete mete. `[Content_Types].xml` es obligatorio en OPC y VS Code
// rechaza el archivo si falta una extensión que sí está adentro del zip.
const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="map" ContentType="application/json" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`

function archivosDe(dir) {
  const salida = []
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada)
    if (statSync(p).isDirectory()) salida.push(...archivosDe(p))
    else salida.push(p)
  }
  return salida
}

const dist = join(RAIZ, 'dist')
if (!existsSync(dist)) {
  console.error('No hay dist/. Corré `tsc -p tsconfig.json` primero.')
  process.exit(1)
}

const zip = new AdmZip()
zip.addFile('extension.vsixmanifest', Buffer.from(VSIXMANIFEST, 'utf8'))
zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES, 'utf8'))
// El `package.json` de la extensión, sin los scripts de build: adentro del `.vsix` sólo
// confunden, porque ahí no hay con qué correrlos.
const { scripts: _scripts, ...paraPublicar } = manifiesto
zip.addFile('extension/package.json', Buffer.from(JSON.stringify(paraPublicar, null, 2), 'utf8'))
for (const archivo of archivosDe(dist)) {
  zip.addLocalFile(archivo, join('extension', dirname(relative(RAIZ, archivo))))
}

const destino = join(RAIZ, `${name}-${version}.vsix`)
zip.writeZip(destino)
writeFileSync(join(RAIZ, '.gitignore'), 'dist/\n*.vsix\n')
console.log(`${relative(process.cwd(), destino)}  (${zip.getEntries().length} archivos)`)
