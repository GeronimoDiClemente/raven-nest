# -*- coding: utf-8 -*-
# Guiones en PUNTOS (una carilla A4 por persona, para tener en la mano).
# Reparto de la FINAL: 300 s de pitch. 285 s hablados + ~15 s de los 3 traspasos.
# El detalle tecnico que se saco de los slides vive aca y en "Si preguntan":
# el jurado de la final no es tecnico, asi que en pantalla no va y en la boca si,
# y solo si lo piden.

import io, html

TOTAL = 300

G = {
 "geronimo": {
  "nombre": "Gerónimo Di Clemente", "rol": "CEO",
  "bloques": [
   {"s":"01 · Portada","seg":15,
    "idea":"Qué es Nest, en una línea. Nada más.",
    "puntos":["Nest es donde tu equipo <b>ya</b> trabaja con sus asistentes de IA.",
              "Por eso es donde puede vivir su memoria.",
              "Hablá de <b>asistentes</b>, no de “agentes”. De <b>memoria</b>, no de “contexto”."]},
   {"s":"02 · El problema","seg":35,
    "idea":"El tiempo que se pierde repitiendo lo mismo todos los días.",
    "puntos":["Arrancá por lo cotidiano: <b>todas las mañanas le explicás el mismo proyecto de cero</b>.",
              "El dibujo hace el trabajo: cinco islas, ninguna línea entre ellas. Señalalo.",
              "Cerrá con el dato de afuera: <b>61 % pierde más de media hora por día</b> (Stack Overflow 2024).",
              "Que se entienda que es plata: media hora por día, por persona."]},
   {"s":"03 · La solución","seg":30,
    "idea":"No es que guardamos memoria. Es dónde estamos parados.",
    "puntos":["Nest ya está <b>abajo</b> de todo el trabajo: por eso ve lo que pasa mientras pasa.",
              "Los demás dependen de que alguien <b>se acuerde</b> de anotar. Ahí está la diferencia.",
              "Tres cosas, una por columna: se llena sola · la ve el equipo · ni nosotros la leemos.",
              "La imagen: <b>un diario hay que sentarse a escribirlo; una cámara ya está prendida</b>."],
    "pase":"Pasás a Bauti: cómo se llena."},
   {"s":"10 · Plan · 12 meses","seg":20,
    "idea":"Doce meses, todos de Memories.",
    "puntos":["Mes 1-3: funciona con cualquier asistente, <b>aunque no tengan Nest abierto</b>.",
              "Mes 4-6: la llave del equipo — destraba a los que hoy no subirían nada.",
              "Mes 7-12: diez equipos probándolo, y crecemos <b>por equipos, no de a uno</b>.",
              ],
    "pase":"Venís de Mati. Retomás vos."},
   {"s":"11 · El pedido","seg":20,
    "idea":"Un solo pedido, concreto. Mirá al jurado, no a la pantalla.",
    "puntos":["Contactos con <b>10 equipos de 5 programadores</b>, para probarlo 90 días.",
              "Lo que medimos: <b>cuántos siguen pagando el día 91</b>.",
              "Cerrá con la frase del slide: <b>Nest corre los asistentes de tu equipo; por eso es donde puede vivir su memoria.</b>",
              "⚠️ Ya NO se cierra con “y pasar a la final”: estamos en la final."]},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Lo pedís vos en el slide 11. Respuesta corta: si quieren el detalle, lo tiene Bauti.",
   "puntos": [
    "Un equipo de <b>5 programadores o más</b> que usa Nest <b>90 días</b>.",
    "Arranca gratis. A los 30 días activan la memoria de equipo, sin cargo durante el piloto.",
    "<b>Día 91 deciden si pagan</b> — eso es exactamente lo que medimos.",
   ]},
  "preguntas":[
   ("¿Por qué no lo hace Microsoft o GitHub?",
    "Copilot Memory ya existe: es personal, no de equipo, y olvida al mes. El problema no es guardar la memoria, es que alguien se ocupe de ella."),
   ("¿De dónde salen los 400 equipos?",
    "400 equipos × 5 personas = 2.000 asientos, en tres años, sobre nuestro precio más bajo (el anual)."),
   ("¿Esto no lo hace ya ChatGPT con su memoria?",
    "Esa es la memoria de una persona con un chat. La nuestra es la del equipo sobre su propio trabajo, y se llena sola mientras trabajan."),
  ]},

 "bautista": {
  "nombre": "Bautista Martínez Vuoto", "rol": "CMO",
  "bloques": [
   {"s":"04 · Cómo se llena","seg":35,
    "idea":"El mismo dibujo del problema, ahora conectado. Ése es el momento.",
    "puntos":["Empezá señalando: <b>son las mismas cinco personas del slide anterior</b>. Ahora todo baja a un solo lugar.",
              "Los tres pasos, cortos: entra el trabajo → trabajan los asistentes → queda lo que aprendieron.",
              "Leé la memoria de ejemplo en voz alta: <i>“el cobro va por Stripe, no por MercadoPago”</i>.",
              "El remate: <b>nadie la escribió</b>. Se escribió sola, y sabe de qué tarea salió.",
              "Si hay que elegir qué decir, decí esto: <b>no es una maqueta, ya funciona</b>."],
    "pase":"Arrancás vos, después de Gero. Enganchá directo, sin presentarte."},
   {"s":"05 · Mercado","seg":25,
    "idea":"De abajo hacia arriba, y sobre el precio más bajo.",
    "puntos":["<b>No leas las tres cajas</b>: ya están en pantalla. Decí sólo el último número.",
              "US$ 192.000 a tres años, y por qué se defiende: 400 equipos de 5.",
              "El detalle que importa: está calculado sobre <b>US$ 96 al año</b>, nuestro precio más bajo.",
              "O sea: <b>el peor caso ya está adentro del número</b>."]},
   {"s":"06 · Modelo","seg":25,
    "idea":"Entrar es gratis. Se paga cuando el equipo quiere ver la memoria de todos.",
    "puntos":["US$ 10 por persona al mes. Un equipo de cinco: <b>US$ 40 al mes</b>.",
              "Una persona sola: <b>gratis y sin vencimiento</b>. Por eso entran.",
              "Se paga recién cuando quieren que el equipo vea esa memoria.",
              "Es recurrente desde el primer equipo que paga."],
    "pase":"Pasás a Mati: qué hay construido."},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Si lo preguntan, es tuyo. Gero lo pide en el slide 11 en una línea.",
   "puntos": [
    "Un equipo de <b>5 programadores o más</b> sobre un proyecto compartido, <b>90 días</b>.",
    "<b>Días 1-30:</b> instalan gratis y trabajan. La memoria se llena sola, pero es de cada uno.",
    "<b>Días 31-90:</b> activan la memoria de equipo, sin cargo durante el piloto.",
    "<b>Día 91:</b> deciden si pagan los US$ 10 por persona.",
    "Nosotros ponemos el servicio gratis y el acompañamiento; ellos, uso real y una charla de 30 min al cierre.",
    "<b>Medimos:</b> cuántos activan la memoria de equipo · cuánto se escribió solo · <b>cuántos siguen pagando el día 91</b>.",
    "<b>Por qué 10 equipos y 90 días:</b> no es por la plata (50 asientos son US$ 500/mes), es por la tasa de conversión. En dos semanas no hay memoria acumulada que pruebe nada.",
   ]},
  "preguntas":[
   ("¿Por qué tan barato?",
    "Es deliberado: queremos el equipo entero adentro, no una persona suelta pagando caro."),
   ("¿De dónde sale el 61 %?",
    "Stack Overflow Developer Survey 2024, sobre unas 65.000 respuestas de programadores."),
   ("¿Y si no pasan de gratis a pago?",
    "Es justo lo que vamos a medir con los 10 pilotos en 90 días. Por eso el pedido es ése y no plata."),
   ("¿Por qué 18 millones de programadores?",
    "30 millones de programadores profesionales, de los cuales el 60 % ya trabaja con asistentes."),
  ]},

 "matias": {
  "nombre": "Matías Labari", "rol": "CTO",
  "bloques": [
   {"s":"07 · Tracción","seg":25,
    "idea":"Está corriendo hoy, no es un plan.",
    "puntos":["~100 personas lo usan todos los días, con actualización automática.",
              "2 equipos lo usan para <b>trabajo de clientes reales</b>, no sólo para lo nuestro.",
              "7 asistentes distintos funcionan adentro · v1.5 en Windows, Mac y Linux.",
              "Lo difícil ya lo operamos: el servicio corre en producción con copias de seguridad.",
              "Decí en voz alta que <b>todavía no cobramos</b>: lo que tenemos es uso, no facturación. Es más creíble."],
    "pase":"Venís de Bauti. Rápido y seco, sin adornos."},
   {"s":"08 · Competencia","seg":30,
    "idea":"Todos resuelven la memoria. Ninguno se ocupa de mantenerla.",
    "puntos":["No leas la tabla entera: <b>señalá la última columna</b> y explicá esa.",
              "Notas a mano: las escribís vos, en cada proyecto.",
              "Copilot Memory (Microsoft): se llena sola, pero es personal y olvida al mes.",
              "Engram, el más parecido: es gratis y abierto, pero <b>alguien del equipo se vuelve administrador de servidores</b>.",
              "Nosotros: lo operamos nosotros, vos no ves un servidor. <b>Ésa es la venta.</b>"]},
   {"s":"09 · Equipo","seg":25,
    "idea":"Quiénes somos y por qué nosotros.",
    "puntos":["Los tres, con nombre y rol: Gerónimo CEO, vos CTO, Bautista CMO.",
              "Somos los usuarios: cuatro asistentes en paralelo, todos los días.",
              "Hacemos software de terceros arriba de Nest: no es un experimento.",
              "Hace meses que lo sostenemos funcionando <b>en las máquinas de otra gente</b>."],
    "pase":"Pasás a Gero: el plan y el cierre."},
  ],
  "preguntas":[
   ("¿Qué pasa si Engram saca su propio hosting mañana?",
    "Seguimos teniendo lo que no pueden copiar: nosotros corremos los asistentes. Que la memoria se llene sola depende de estar abajo del trabajo, no del motor de memoria."),
   ("¿Cómo garantizan la privacidad?",
    "Se cifra en la máquina del cliente y la llave es del equipo: ni un administrador nuestro, con acceso a los servidores, puede leer una memoria."),
   ("¿Cuál es la prueba de que el loop funciona?",
    "Está en el código: <code>electron/integrations/memory-bridge.ts</code> traduce lo que pasa entre los asistentes a memorias escritas, con su origen (tarea, rol, ronda y autor)."),
   ("¿Cuánto software hay hecho?",
    "v1.5 publicada y firmada en los tres sistemas operativos, con 2.388 pruebas automáticas en verde sobre el motor de memoria."),
   ("¿Por qué no lo resume una IA?",
    "Porque pagás por cada mensaje y la calidad es mala: una auditoría sobre 10.134 entradas encontró 97,8 % de ruido. Nosotros guardamos texto plano y buscamos local."),
  ]},
}

CSS = """
@page{size:A4;margin:11mm 15mm 11mm;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:"Segoe UI",system-ui,sans-serif;color:#15201c;background:#fff;}
.head{border-bottom:2px solid #0F5E42;padding-bottom:8px;margin-bottom:13px;
      display:flex;justify-content:space-between;align-items:flex-end;gap:16px;}
.head .q{font-size:22pt;font-weight:600;letter-spacing:-.02em;line-height:1.1;}
.head .r{font-size:8.5pt;color:#0F5E42;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;}
.head .t{font-size:8.5pt;color:#5d6d66;text-align:right;line-height:1.5;white-space:nowrap;}
.head .nota{margin-top:5px;font-size:7.5pt;color:#9aa8a2;line-height:1.35;}
.blq{border-top:1px solid #dfe5e2;padding-top:8px;margin-bottom:8px;break-inside:avoid;}
.blq.primero{border-top:none;padding-top:0;}
.meta{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;}
.meta .s{font-size:9pt;font-weight:700;color:#0F5E42;letter-spacing:.07em;text-transform:uppercase;}
.meta .seg{font-size:9pt;color:#fff;background:#0F5E42;padding:1px 8px;border-radius:9px;
           font-variant-numeric:tabular-nums;font-weight:600;}
.idea{font-size:11.8pt;font-weight:600;line-height:1.26;margin-bottom:4px;letter-spacing:-.01em;}
ul{margin:0;padding-left:17px;}
li{font-size:10pt;line-height:1.38;margin-bottom:2px;color:#26332e;}
li b{color:#0a4a34;}
.pase{margin-top:7px;font-size:9pt;color:#6b7a73;border-left:2px solid #c9d5d0;padding-left:9px;}
.def{margin-top:9px;background:#f2f7f5;border:1px solid #cfe0d8;border-radius:5px;padding:10px 12px;break-inside:avoid;}
.def h2{font-size:9pt;margin:0;color:#0F5E42;letter-spacing:.14em;text-transform:uppercase;}
.def .sub{font-size:8.5pt;color:#6b7a73;margin:2px 0 7px;}
.def li{font-size:9pt;line-height:1.36;margin-bottom:2px;}
.pre{margin-top:8px;border-top:2px solid #0F5E42;padding-top:9px;break-inside:avoid;}
.pre h2{font-size:9pt;margin:0 0 9px;color:#0F5E42;letter-spacing:.14em;text-transform:uppercase;}
.qa{margin-bottom:4px;font-size:9pt;line-height:1.36;}
.qa .p{font-weight:600;}
.qa .a{color:#41524b;}
code{font-family:Consolas,monospace;font-size:8.5pt;background:#eef3f1;padding:1px 4px;border-radius:3px;}
/* Una carilla A4 es el requisito: se tiene en la mano en el escenario.
   Con 5 bloques (Geronimo) el guion se pasaba de pagina, asi que ese caso
   se compacta ~8% en vez de partirse en dos. */
body.denso .head{padding-bottom:6px;margin-bottom:10px;}
body.denso .head .q{font-size:19pt;}
body.denso .blq{padding-top:6px;margin-bottom:6px;}
body.denso .idea{font-size:10.9pt;margin-bottom:3px;}
body.denso li{font-size:9.3pt;line-height:1.32;margin-bottom:1px;}
body.denso .pase{margin-top:5px;font-size:8.5pt;}
body.denso .def{margin-top:7px;padding:8px 10px;}
body.denso .def li{font-size:8.5pt;line-height:1.3;}
body.denso .pre{margin-top:6px;padding-top:7px;}
body.denso .qa{font-size:8.5pt;line-height:1.3;margin-bottom:3px;}
.pie{margin-top:5px;font-size:7.5pt;color:#8b9a93;border-top:1px solid #dfe5e2;padding-top:4px;
     display:flex;justify-content:space-between;gap:12px;}
"""

for key, g in G.items():
    seg = sum(b["seg"] for b in g["bloques"])
    nums = ", ".join(b["s"].split(" · ")[0] for b in g["bloques"])
    denso = len(g["bloques"]) >= 5
    out = ['<meta charset="utf-8">',
           "<title>%s · qué dice</title>" % html.escape(g["nombre"]),
           "<style>%s</style>" % CSS,
           '<body class="denso">' if denso else '',
           '<div class="head"><div><div class="q">%s</div>'
           '<div class="r">%s · pitch final UCAECE</div></div>'
           '<div class="t">Slides %s<br><b>%s s</b> de %s s'
           '<div class="nota">Son puntos, no un texto:<br>decilo con tus palabras.<br>'
           'El jurado <b>no es técnico</b>.</div></div></div>'
           % (html.escape(g["nombre"]), g["rol"], nums, seg, TOTAL)]
    for i, b in enumerate(g["bloques"]):
        li = "".join("<li>%s</li>" % p for p in b["puntos"])
        pase = '<div class="pase">%s</div>' % b["pase"] if b.get("pase") else ""
        out.append('<div class="blq%s"><div class="meta"><span class="s">%s</span>'
                   '<span class="seg">%s s</span></div>'
                   '<div class="idea">%s</div><ul>%s</ul>%s</div>'
                   % (" primero" if i == 0 else "", html.escape(b["s"]), b["seg"], b["idea"], li, pase))
    if g.get("definicion"):
        d = g["definicion"]
        out.append('<div class="def"><h2>%s</h2><div class="sub">%s</div><ul>%s</ul></div>'
                   % (html.escape(d["titulo"]), html.escape(d["sub"]),
                      "".join("<li>%s</li>" % x for x in d["puntos"])))
    out.append('<div class="pre"><h2>Si preguntan</h2>%s</div>' % "".join(
        '<div class="qa"><span class="p">%s</span> <span class="a">%s</span></div>' % (html.escape(p), a)
        for p, a in g["preguntas"]))
    io.open("guion-%s.html" % key, "w", encoding="utf-8", newline="").write("\n".join(out))
    print("guion-%s.html  |  %s s  |  %s slides" % (key, seg, len(g["bloques"])))
hablado = sum(sum(b["seg"] for b in g["bloques"]) for g in G.values())
print("TOTAL hablado:", hablado, "s  ·  traspasos:", TOTAL - hablado, "s  ·  pitch:", TOTAL, "s")
