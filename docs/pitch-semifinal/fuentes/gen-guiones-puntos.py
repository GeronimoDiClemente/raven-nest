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
    "idea":"Abrís con el dato, NO con «somos Nest».",
    "puntos":["<b>6 de cada 10 pierden +30 min por día</b> buscando algo que el equipo ya sabía.",
              "No es desorden: lo que aprenden sus asistentes <b>no queda en ningún lado</b>.",
              "Recién ahí: «Somos Nest, y ahí es donde entramos».",
              "Decí <b>asistentes</b>, no “agentes”. <b>Memoria</b>, no “contexto”."]},
   {"s":"02 · El problema","seg":35,
    "idea":"El dibujo hace el trabajo. Vos sólo lo señalás.",
    "puntos":["Un equipo de cinco, cuatro asistentes cada uno: <b>20 memorias</b>, ninguna se habla.",
              "Comparten el código y las reuniones; <b>no comparten lo que los asistentes aprenden</b>.",
              "Remate: <b>eso, hoy, se evapora</b>. Frená ahí.",
              "⚠️ El 61 % <b>ya lo dijiste</b> en la portada: está escrito abajo, no lo releas."]},
   {"s":"03 · La solución","seg":30,
    "idea":"No inventamos guardar memoria. La diferencia es dónde estamos parados.",
    "puntos":["Nest es donde el equipo <b>ya</b> trabaja: estamos abajo, viendo lo que pasa.",
              "Los demás te piden que <b>te acuerdes</b> de anotar.",
              "La imagen: <b>un diario hay que sentarse a escribirlo; una cámara ya está prendida</b>.",
              "Cerrá con <b>«se escribe sola»</b> — vuelve en el 04 y en el cierre."],
    "pase":"Pasás a Bauti: cómo se llena."},
   {"s":"10 · Plan · 12 meses","seg":20,
    "idea":"Doce meses, todos de Memories.",
    "puntos":["Que funcione con cualquier asistente, <b>sin Nest abierto</b>.",
              "La llave, y que sea del equipo: destraba a los que hoy no subirían nada.",
              "Crecer <b>por equipos enteros</b>, no de a uno."],
    "pase":"Venís de Mati. Retomás vos."},
   {"s":"11 · El pedido","seg":20,
    "idea":"Un pedido concreto. Mirá al jurado, no a la pantalla.",
    "puntos":["<b>10 equipos de 5 programadores, 90 días.</b> No pedimos plata: que lo usen.",
              "Medimos: <b>cuántos siguen pagando el día 91</b>.",
              "Cierre textual: <b>Nest corre los asistentes de tu equipo, y por eso es el único "
              "lugar donde su memoria puede quedarse.</b>",
              "⚠️ Ya NO se cierra con “y pasar a la final”."]},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Lo pedís vos en el slide 11. Si quieren el detalle, lo tiene Bauti.",
   "puntos": [
    "Un equipo de <b>5 programadores o más</b> que usa Nest <b>90 días</b>.",
    "Arranca gratis. A los 30 días activan la memoria de equipo, sin cargo.",
    "<b>Día 91 deciden si pagan</b> — eso es lo que medimos.",
   ]},
  "preguntas":[
   ("¿Por qué no lo hace Microsoft o GitHub?",
    "Copilot Memory ya existe: es personal, no de equipo, y olvida al mes. El problema no es guardar la memoria, es que alguien se ocupe de ella."),
   ("¿De dónde salen los 400 equipos?",
    "400 equipos × 5 personas = 2.000 asientos, en tres años, sobre nuestro precio más bajo."),
   ("¿Esto no lo hace ya ChatGPT con su memoria?",
    "Esa es la memoria de una persona con un chat. La nuestra es la del equipo sobre su propio trabajo, y se llena sola mientras trabajan."),
   ("¿Ustedes son cinco?",
    "Somos tres. El equipo de cinco del ejemplo es el tamaño típico del cliente que buscamos."),
  ]},

 "bautista": {
  "nombre": "Bautista Martínez Vuoto", "rol": "CMO",
  "bloques": [
   {"s":"04 · Cómo se llena","seg":35,
    "idea":"El mismo dibujo, ahora conectado. Éste es EL momento del pitch.",
    "puntos":["Empezá señalando: <b>son las mismas cinco personas del slide anterior</b>. Dejá un segundo.",
              "Tres pasos: entra el trabajo → trabajan los asistentes → queda lo que aprendieron.",
              "Leé la memoria en voz alta: <i>«el cobro va por Stripe, no por MercadoPago»</i>.",
              "<b>Esa frase no la escribió nadie.</b> Nadie abrió un documento.",
              "El beneficio, despacio: <b>mañana otro toca esa parte y su asistente ya lo sabe</b>."],
    "pase":"Arrancás vos, después de Gero. Enganchá directo, sin presentarte."},
   {"s":"05 · Mercado","seg":25,
    "idea":"De abajo hacia arriba, sobre el precio más barato.",
    "puntos":["<b>No leas las tres cajas</b>: decí sólo el último número.",
              "<b>US$ 192.000</b> a tres años = 400 equipos.",
              "Calculado sobre el precio más barato: <b>el peor caso ya está adentro</b>.",
              "Si preguntan por los 18 M: 30 M de programadores, 60 % ya usa asistentes."]},
   {"s":"06 · Modelo","seg":25,
    "idea":"Entrar no cuesta nada. Se cobra que el equipo la comparta.",
    "puntos":["US$ 10 por persona al mes. Un equipo de cinco: <b>US$ 40</b>.",
              "Una persona sola: <b>gratis, para siempre</b>. Por eso entran.",
              "Frase a dejar clara: <b>entrar no cuesta nada; se cobra compartirla</b>."],
    "pase":"Pasás a Mati: qué hay construido."},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Si lo preguntan, es tuyo. Gero lo pide en el slide 11 en una línea.",
   "puntos": [
    "Un equipo de <b>5 programadores o más</b> sobre un proyecto compartido, <b>90 días</b>.",
    "<b>Días 1-30:</b> instalan gratis. La memoria se llena sola, pero es de cada uno.",
    "<b>Días 31-90:</b> activan la memoria de equipo, sin cargo durante el piloto.",
    "<b>Día 91:</b> deciden si pagan los US$ 10 por persona.",
    "<b>Medimos:</b> cuántos activan la memoria de equipo · cuánto se escribió solo · <b>cuántos siguen pagando el día 91</b>.",
    "<b>Por qué 10 y 90 días:</b> no es la plata, es la tasa de conversión. En dos semanas no hay memoria acumulada que pruebe nada.",
   ]},
  "preguntas":[
   ("¿Por qué tan barato?",
    "Es deliberado: queremos el equipo entero adentro, no una persona suelta pagando caro."),
   ("¿De dónde sale el 61 %?",
    "Stack Overflow Developer Survey 2024, sobre unas 65.000 respuestas de programadores."),
   ("¿Y si no pasan de gratis a pago?",
    "Es justo lo que vamos a medir con los 10 pilotos en 90 días. Por eso el pedido es ése y no plata."),
  ]},

 "matias": {
  "nombre": "Matías Labari", "rol": "CTO",
  "bloques": [
   {"s":"07 · Tracción","seg":25,
    "idea":"No es una idea: está funcionando.",
    "puntos":["~100 personas lo usan todos los días.",
              "2 equipos lo usan para <b>clientes reales</b>, no sólo para lo nuestro.",
              "Windows, Mac y Linux · 7 asistentes distintos adentro.",
              "<b>Todavía no cobramos.</b> Lo que tenemos no es facturación, es gente usándolo."],
    "pase":"Venís de Bauti. Rápido y seco, sin adornos."},
   {"s":"08 · Competencia","seg":30,
    "idea":"Todos guardan la memoria. Ninguno se ocupa de mantenerla.",
    "puntos":["<b>No leas la tabla</b>: señalá la última columna y explicá esa.",
              "Notas a mano: las escribís vos, proyecto por proyecto.",
              "Microsoft: se llena sola, pero es personal y olvida al mes.",
              "El más parecido: gratis y abierto, pero <b>alguien se vuelve administrador de servidores</b>.",
              "<b>Con nosotros no ves un servidor. Nunca.</b> Ésa es la venta."]},
   {"s":"09 · Equipo","seg":25,
    "idea":"Quiénes somos y por qué nosotros.",
    "puntos":["Los tres con nombre: Gerónimo CEO, vos CTO, Bautista CMO. Sin apurarte.",
              "Somos los primeros usuarios: cuatro asistentes en paralelo, todos los días.",
              "Hacemos software para clientes arriba de Nest.",
              "Hace meses que funciona <b>en las máquinas de otra gente</b>, no en la nuestra."],
    "pase":"Pasás a Gero: el plan y el cierre."},
  ],
  "preguntas":[
   ("¿Qué pasa si el competidor saca su propio hosting mañana?",
    "Seguimos teniendo lo que no pueden copiar: nosotros corremos los asistentes. Que la memoria se llene sola depende de estar abajo del trabajo, no del motor de memoria."),
   ("¿Y las 6.450 estrellas de Engram?",
    "Las estrellas no le operan el servidor a nadie. Nuestro producto es la operación, no el motor."),
   ("¿Cómo garantizan la privacidad?",
    "Se cifra en la máquina del cliente y la llave es del equipo: ni un administrador nuestro, con acceso a los servidores, puede leer una memoria."),
   ("¿Cuál es la prueba de que esto funciona solo?",
    "Está en el código: <code>electron/integrations/memory-bridge.ts</code> traduce lo que pasa entre los asistentes a memorias escritas, con su origen (tarea, rol, ronda y autor)."),
   ("¿Cuánto software hay hecho?",
    "v1.5 publicada y firmada en los tres sistemas operativos, con 2.388 pruebas automáticas en verde."),
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
