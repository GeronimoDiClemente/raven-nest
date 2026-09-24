# -*- coding: utf-8 -*-
# Guiones con el TEXTO COMPLETO (una carilla A4 por persona, para memorizarlo).
# En el escenario se usa el de puntos; este es para aprenderselo.
# Reparto de la FINAL: 300 s. Textos reescritos para un jurado NO tecnico:
# nada de runtime, pane, diff, worktree, cifrado del lado del cliente ni nombres
# de archivo. Eso vive en "Si preguntan", en el guion de puntos.

import io, html

TOTAL = 300

GENTE = {
 "geronimo": {"nombre":"Gerónimo Di Clemente", "rol":"CEO", "slides":"01, 02, 03, 10, 11",
  "bloques":[
   {"s":"01 · Portada","seg":15,
    "texto":"Buenas. Somos Nest. Hoy los equipos de desarrollo trabajan todo el día con asistentes "
            "de inteligencia artificial. Nosotros somos el lugar donde ese equipo los usa. Y por eso "
            "somos el lugar donde su memoria puede quedarse.",
    "nota":"Arrancá parado y mirando al jurado, no a la pantalla. Estos quince segundos deciden si "
           "te escuchan el resto."},
   {"s":"02 · El problema","seg":35,
    "texto":"Te lo cuento con lo que nos pasa a nosotros. Somos cinco, y cada uno trabaja con cuatro "
            "asistentes. Todas las mañanas, cada uno le vuelve a explicar el mismo proyecto de cero. "
            "Mirá el dibujo: son veinte memorias separadas, y ninguna se habla con las otras. "
            "Compartimos el proyecto, pero no compartimos nada de lo que esos asistentes ya "
            "aprendieron. Y no nos pasa sólo a nosotros: seis de cada diez programadores pierden "
            "más de media hora por día buscando algo que alguien del equipo ya había resuelto.",
    "nota":"Señalá el dibujo cuando digas «veinte memorias». El dato es de Stack Overflow sobre "
           "65.000 respuestas; está en el slide, decilo sólo si querés apoyarlo."},
   {"s":"03 · La solución","seg":30,
    "texto":"Y acá está la diferencia. No es que nosotros guardamos memoria y los demás no. Es "
            "<b>dónde estamos parados</b>. Como Nest está abajo de todo el trabajo, ve lo que pasa "
            "mientras pasa, y lo guarda solo. Los demás dependen de que alguien se acuerde de "
            "anotarlo. Es la diferencia entre un diario que hay que sentarse a escribir y una cámara "
            "que ya está prendida. Y además: la ve todo el equipo, y ni nosotros podemos leerla.",
    "nota":"Bajá el ritmo en «dónde estamos parados». Es la idea que tienen que llevarse a la casa.",
    "pase":"Te paso con Bauti, que te muestra cómo se llena."},
   {"s":"10 · Plan · 12 meses","seg":20,
    "texto":"Los próximos doce meses son todos de Memories. Primero, que funcione con cualquier "
            "asistente, aunque no tengan Nest abierto. Después, la llave del equipo: que se guarde "
            "cerrada, para destrabar a los que hoy no subirían nada. Y de ahí en adelante, crecer "
            "por equipos y no de a una persona.",
    "nota":"Retomás vos después de Mati. Enganchá sin presentarte de nuevo."},
   {"s":"11 · El pedido","seg":20,
    "texto":"Lo que necesitamos son contactos: diez equipos de cinco programadores, noventa días, "
            "para probar Memories. Lo que vamos a medir es cuántos siguen pagando el día noventa y "
            "uno. Nest está en <b>nestmux.com</b> y se puede bajar hoy, gratis. Nest corre los "
            "asistentes de tu equipo: por eso es donde puede vivir su memoria. Gracias.",
    "nota":"⚠️ Ya no se cierra con «y pasar a la final»: estamos EN la final. Frená antes de la "
           "última frase: es el remate y necesita el silencio de antes."},
  ],
  "piloto":["Un equipo de <b>5 programadores o más</b> que usa Nest <b>90 días</b>.",
            "Arranca gratis. A los 30 días activan la memoria de equipo, sin cargo durante el piloto.",
            "<b>Día 91 deciden si pagan</b> — eso es exactamente lo que medimos.",
            "No buscamos los US$ 500 al mes: buscamos <b>cuántos pasan de gratis a pago</b>.",
            "Si quieren el detalle fino, lo tiene Bauti."]},

 "bautista": {"nombre":"Bautista Martínez Vuoto", "rol":"CMO", "slides":"04, 05, 06",
  "bloques":[
   {"s":"04 · Cómo se llena","seg":35,
    "texto":"Mirá el dibujo: son las mismas cinco personas que te mostró Gero recién, pero ahora "
            "todo baja a un mismo lugar. Funciona así: entra el trabajo, trabajan los asistentes, y "
            "queda lo que aprendieron. Te leo una de verdad: «el cobro va por Stripe, no por "
            "MercadoPago». Esa memoria <b>no la escribió nadie</b>. Se escribió sola mientras el "
            "equipo trabajaba, y quedó guardada sabiendo de qué tarea salió, quién estaba y cuándo "
            "fue. Esto no es una maqueta: ya está funcionando.",
    "nota":"Señalá el dibujo en «las mismas cinco personas». Ese reconocimiento es el momento más "
           "fuerte del pitch: dejá un segundo de silencio ahí.",
    "pase":"Arrancás vos, después de Gero. Enganchá directo, sin presentarte."},
   {"s":"05 · Mercado","seg":25,
    "texto":"El mercado lo calculamos de abajo hacia arriba. Hay dieciocho millones de programadores "
            "que ya trabajan con asistentes. Nosotros vamos primero a Latinoamérica y España, "
            "nuestro idioma y nuestro horario. Y lo que decimos que vamos a ganar en tres años son "
            "<b>ciento noventa y dos mil dólares</b>: cuatrocientos equipos de cinco personas. "
            "Todo calculado sobre nuestro precio más bajo, así que el peor caso ya está adentro "
            "del número.",
    "nota":"No leas las tres cajas, ya están en pantalla. Decí sólo el último número y por qué "
           "se defiende."},
   {"s":"06 · Modelo","seg":25,
    "texto":"El modelo es una suscripción por persona: diez dólares al mes, ocho si pagan el año "
            "entero. Un equipo de cinco entra por cuarenta dólares al mes. Una persona sola lo usa "
            "<b>gratis y para siempre</b>: por eso entran. Y se paga recién cuando quieren que el "
            "equipo entero vea esa memoria. O sea, entrar es gratis, y lo que se cobra es que el "
            "equipo la comparta.",
    "nota":"Es la frase que más repetimos: entrar es gratis, se paga la memoria compartida.",
    "pase":"Te paso con Mati, que te cuenta qué hay construido."},
  ],
  "piloto":["Un equipo de <b>5 programadores o más</b> sobre un proyecto compartido, <b>90 días</b>.",
            "<b>Días 1-30:</b> instalan gratis. La memoria se llena sola, pero es de cada uno.",
            "<b>Días 31-90:</b> activan la memoria de equipo, sin cargo durante el piloto.",
            "<b>Día 91:</b> deciden si pagan los US$ 10 por persona.",
            "<b>Medimos:</b> cuántos activan la memoria de equipo, cuánto se escribió solo y "
            "<b>cuántos siguen pagando el día 91</b>.",
            "<b>Por qué 10 equipos y 90 días:</b> no es por la plata, es por la tasa de conversión. "
            "En dos semanas no hay memoria acumulada que pruebe nada."]},

 "matias": {"nombre":"Matías Labari", "rol":"CTO", "slides":"07, 08, 09",
  "bloques":[
   {"s":"07 · Tracción","seg":25,
    "texto":"Esto no es un plan: está corriendo. Alrededor de cien personas usan Nest todos los "
            "días. Dos equipos lo usan para trabajo de clientes reales, no sólo para lo nuestro. "
            "Funciona en Windows, Mac y Linux, con siete asistentes distintos adentro. Y todavía "
            "<b>no cobramos</b>: está gratis durante el lanzamiento. Lo que tenemos es uso.",
    "nota":"Decir que todavía no cobramos suma, no resta: es más creíble que inventar facturación.",
    "pase":"Venís de Bauti. Rápido y seco, sin adornos."},
   {"s":"08 · Competencia","seg":30,
    "texto":"Acá todos resuelven más o menos lo mismo: guardar la memoria. Lo que ninguno resuelve "
            "es <b>quién se ocupa de mantenerla</b>. Las notas a mano las escribís vos, proyecto por "
            "proyecto. La de Microsoft se llena sola, pero es personal y se olvida al mes. El "
            "competidor más parecido es gratis y abierto, pero para que el equipo la comparta "
            "alguien del equipo se tiene que volver administrador de servidores. Con nosotros, vos "
            "no ves un servidor. Ésa es la venta.",
    "nota":"No leas la tabla entera: señalá la última columna y explicá esa. Si te tiran que el "
           "competidor tiene 6.450 estrellas, la respuesta es que las estrellas no operan el "
           "servidor de nadie."},
   {"s":"09 · Equipo","seg":25,
    "texto":"Lo construimos porque lo necesitábamos nosotros. Gerónimo es el CEO, yo soy el CTO y "
            "Bautista es el CMO. Somos los usuarios: trabajamos con cuatro asistentes en paralelo "
            "todos los días. Y no lo probamos sólo con nuestro producto, hacemos software para "
            "clientes arriba de Nest. Lo difícil ya lo venimos operando hace meses, funcionando en "
            "las máquinas de otra gente.",
    "nota":"Nombrá a los tres sin apurarte: es la parte que el jurado marcó como floja la vez pasada.",
    "pase":"Te devuelvo con Gero, que cierra con el plan y el pedido."},
  ]},
}

CSS = """
@page{size:A4;margin:12mm 16mm;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:"Segoe UI",system-ui,sans-serif;color:#15201c;background:#fff;}
.head{border-bottom:2px solid #0F5E42;padding-bottom:9px;margin-bottom:15px;
      display:flex;justify-content:space-between;align-items:flex-end;gap:16px;}
.head .q{font-size:21pt;font-weight:600;letter-spacing:-.02em;line-height:1.1;}
.head .r{font-size:8.5pt;color:#0F5E42;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;}
.head .t{font-size:8.5pt;color:#5d6d66;text-align:right;line-height:1.5;white-space:nowrap;}
.head .nota{margin-top:5px;font-size:7.5pt;color:#9aa8a2;line-height:1.35;}
.blq{border-top:1px solid #dfe5e2;padding-top:10px;margin-bottom:13px;break-inside:avoid;}
.blq.primero{border-top:none;padding-top:0;}
.meta{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
.meta .s{font-size:8.5pt;font-weight:700;color:#0F5E42;letter-spacing:.07em;text-transform:uppercase;}
.meta .seg{font-size:8.5pt;color:#fff;background:#0F5E42;padding:1px 8px;border-radius:9px;
           font-variant-numeric:tabular-nums;font-weight:600;}
.txt{font-family:Georgia,"Times New Roman",serif;font-size:12.5pt;line-height:1.5;}
.txt b{color:#0a4a34;}
.nota{margin-top:6px;font-size:8.5pt;color:#6b7a73;border-left:2px solid #c9d5d0;padding-left:9px;line-height:1.4;}
.pase{margin-top:5px;font-family:Georgia,serif;font-size:10.5pt;color:#0F5E42;font-style:italic;}
.def{margin-top:10px;background:#f2f7f5;border:1px solid #cfe0d8;border-radius:5px;padding:9px 11px;break-inside:avoid;}
.def h2{font-size:8.5pt;margin:0 0 6px;color:#0F5E42;letter-spacing:.14em;text-transform:uppercase;}
ul{margin:0;padding-left:16px;}
.def li{font-size:9pt;line-height:1.38;margin-bottom:2px;}
/* misma razon que en el guion de puntos: una carilla, no dos */
body.denso .head{padding-bottom:6px;margin-bottom:11px;}
body.denso .head .q{font-size:18pt;}
body.denso .blq{padding-top:7px;margin-bottom:9px;}
body.denso .txt{font-size:11.4pt;line-height:1.42;}
body.denso .nota{margin-top:4px;font-size:8pt;line-height:1.32;}
body.denso .pase{font-size:9.5pt;margin-top:4px;}
body.denso .def{margin-top:7px;padding:8px 10px;}
body.denso .def li{font-size:8.4pt;line-height:1.3;}
"""

for key, g in GENTE.items():
    seg = sum(b["seg"] for b in g["bloques"])
    pal = sum(len(b["texto"].replace("<b>", "").replace("</b>", "").split()) for b in g["bloques"])
    denso = len(g["bloques"]) >= 5
    out = ['<meta charset="utf-8">',
           "<title>%s · para aprender</title>" % html.escape(g["nombre"]),
           "<style>%s</style>" % CSS,
           '<body class="denso">' if denso else '',
           '<div class="head"><div><div class="q">%s</div>'
           '<div class="r">%s · pitch final UCAECE</div></div>'
           '<div class="t">Slides %s<br><b>%s s</b> de %s s<br>%s palabras · ~%.1f por segundo'
           '<div class="nota">Para aprendértelo.<br>En el escenario usá el de puntos.</div>'
           '</div></div>' % (html.escape(g["nombre"]), g["rol"], g["slides"], seg, TOTAL, pal, pal / seg)]
    for i, b in enumerate(g["bloques"]):
        pase = '<div class="pase">%s</div>' % b["pase"] if b.get("pase") else ""
        out.append('<div class="blq%s"><div class="meta"><span class="s">%s</span>'
                   '<span class="seg">%s s</span></div><div class="txt">%s</div>%s'
                   '<div class="nota">%s</div></div>'
                   % (" primero" if i == 0 else "", html.escape(b["s"]), b["seg"],
                      b["texto"], pase, b["nota"]))
    if g.get("piloto"):
        out.append('<div class="def"><h2>Qué es un piloto</h2><ul>%s</ul></div>'
                   % "".join("<li>%s</li>" % x for x in g["piloto"]))
    io.open("guion-%s-texto.html" % key, "w", encoding="utf-8", newline="").write("\n".join(out))
    print("guion-%s-texto.html | %s s | %s palabras | %.2f palabras/s" % (key, seg, pal, pal / seg))
