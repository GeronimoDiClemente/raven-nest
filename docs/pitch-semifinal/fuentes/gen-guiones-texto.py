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
    "texto":"Seis de cada diez programadores pierden más de media hora por día buscando algo que "
            "alguien de su equipo ya sabía. Y no es desorden: es que todo lo que aprenden sus "
            "asistentes de inteligencia artificial no queda en ningún lado. Somos Nest, y ahí es "
            "donde entramos.",
    "nota":"Arrancá con el dato, sin presentarte. Parado, mirando al jurado, no a la pantalla. "
           "El nombre va al final: primero que entiendan el problema."},
   {"s":"02 · El problema","seg":35,
    "texto":"Te lo muestro con un caso concreto. Un equipo de cinco personas, cada una trabajando "
            "con cuatro asistentes. Mirá el dibujo: son veinte memorias separadas, y ninguna se "
            "habla con las otras. El equipo comparte el código y comparte las reuniones. Lo único "
            "que no comparte es lo que esos asistentes aprenden todos los días. Y eso, hoy, "
            "se evapora.",
    "nota":"Señalá el dibujo en «veinte memorias». El dato del 61 % ya lo dijiste en la portada: "
           "está escrito abajo con la fuente, pero NO lo releas. Frená en «se evapora»."},
   {"s":"03 · La solución","seg":30,
    "texto":"Y acá está la diferencia. Nosotros no inventamos guardar memoria: eso lo hace medio "
            "mundo. La diferencia es <b>dónde estamos parados</b>. Nest es el lugar donde tu equipo "
            "ya trabaja, así que estamos abajo de todo, viendo lo que pasa mientras pasa. Los demás "
            "te piden que te acuerdes de anotar. Es la diferencia entre un diario, que hay que "
            "sentarse a escribir, y una cámara que ya está prendida. Nosotros no le preguntamos a "
            "nadie: <b>se escribe sola</b>.",
    "nota":"Bajá el ritmo en «dónde estamos parados» y en «se escribe sola». Son las dos frases "
           "que tienen que quedar. «Se escribe sola» vuelve en el slide 04 y en el cierre.",
    "pase":"Te paso con Bauti, que te muestra cómo se llena."},
   {"s":"10 · Plan · 12 meses","seg":20,
    "texto":"Los próximos doce meses son todos de esto. Primero, que la memoria funcione con "
            "cualquier asistente, aunque no tengan Nest abierto. Después, la llave: que quede "
            "cerrada y que la llave sea del equipo, porque eso destraba a las empresas que hoy no "
            "subirían nada. Y después, crecer por equipos enteros y no de a uno.",
    "nota":"Retomás vos después de Mati. Enganchá sin presentarte de nuevo."},
   {"s":"11 · El pedido","seg":20,
    "texto":"Lo que venimos a pedir son contactos: diez equipos de cinco programadores, noventa "
            "días. No les pedimos plata, les pedimos que lo usen. Lo que vamos a medir es cuántos "
            "siguen pagando el día noventa y uno. Nest se baja hoy, gratis, en <b>nestmux.com</b>. "
            "Y la idea es una sola: <b>Nest corre los asistentes de tu equipo, y por eso es el "
            "único lugar donde su memoria puede quedarse</b>. Gracias.",
    "nota":"⚠️ Ya no se cierra con «y pasar a la final»: estamos EN la final. Frená un segundo "
           "antes de la última frase: es el remate y necesita el silencio de antes."},
  ],
  "piloto":["Un equipo de <b>5 programadores o más</b> que usa Nest <b>90 días</b>.",
            "Arranca gratis. A los 30 días activan la memoria de equipo, sin cargo durante el piloto.",
            "<b>Día 91 deciden si pagan</b> — eso es exactamente lo que medimos.",
            "Si quieren el detalle fino, lo tiene Bauti."]},

 "bautista": {"nombre":"Bautista Martínez Vuoto", "rol":"CMO", "slides":"04, 05, 06",
  "bloques":[
   {"s":"04 · Cómo se llena","seg":35,
    "texto":"Mirá el dibujo: son las mismas cinco personas que te mostró Gero recién. Ahora todo "
            "baja a un mismo lugar. Funciona así: entra el trabajo, "
            "trabajan los asistentes, y queda lo que aprendieron. Te leo una de verdad, tal como "
            "quedó guardada: «el cobro va por Stripe, no por MercadoPago». Esa frase <b>no la "
            "escribió nadie</b>. Nadie abrió un documento, nadie anotó nada. Se escribió sola "
            "mientras el equipo trabajaba, y sabe de qué tarea salió y quién estaba. Y mañana, "
            "cuando otro del equipo toque esa parte, <b>su asistente ya lo "
            "sabe</b>.",
    "nota":"Señalá el dibujo en «las mismas cinco personas»: ese reconocimiento es el momento más "
           "fuerte del pitch, dejá un segundo de silencio ahí. La última frase es el beneficio "
           "entero: decila despacio.",
    "pase":"Arrancás vos, después de Gero. Enganchá directo, sin presentarte."},
   {"s":"05 · Mercado","seg":25,
    "texto":"El mercado lo calculamos de abajo hacia arriba. Hay dieciocho millones de programadores "
            "que ya trabajan con asistentes. Nosotros arrancamos por Latinoamérica y España: "
            "nuestro idioma y nuestro horario. Y lo que podemos ganar en "
            "tres años son <b>ciento noventa y dos mil dólares</b>: cuatrocientos equipos. Está "
            "calculado sobre nuestro precio más barato, así que el peor caso ya está adentro del "
            "número.",
    "nota":"No leas las tres cajas, ya están en pantalla: decí sólo el último número y por qué se "
           "defiende. Si te preguntan de dónde sale el 18 millones: 30 millones de programadores "
           "profesionales, 60 % ya usa asistentes."},
   {"s":"06 · Modelo","seg":25,
    "texto":"El modelo es simple: diez dólares por persona al mes. Un equipo de cinco entra por "
            "cuarenta dólares al mes. Y una persona sola lo usa <b>gratis, para siempre</b>: por eso "
            "entran. Se paga recién cuando quieren que el equipo entero vea esa memoria. O sea: "
            "<b>entrar no cuesta nada; lo que se cobra es que el equipo la comparta</b>.",
    "nota":"Es la frase que más repetimos en todo el pitch. Que quede clarita.",
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
    "texto":"Esto no es una idea: está funcionando. Alrededor de cien personas usan Nest todos los "
            "días. Dos equipos lo usan para trabajo de clientes reales, no sólo para lo nuestro. "
            "Funciona en Windows, en Mac y en Linux. Y todavía <b>no cobramos</b>: está gratis "
            "durante el lanzamiento. Así que lo que tenemos no es facturación — es gente usándolo.",
    "nota":"Decir que todavía no cobramos suma, no resta: es más creíble que inventar facturación.",
    "pase":"Venís de Bauti. Rápido y seco, sin adornos."},
   {"s":"08 · Competencia","seg":30,
    "texto":"Acá todos resuelven lo mismo: guardar la memoria. Lo que ninguno "
            "resuelve es <b>quién se ocupa de mantenerla</b>. Las notas a mano las escribís vos, "
            "proyecto por proyecto. La de Microsoft se llena sola, pero es de cada persona y se "
            "olvida al mes. Y el competidor más parecido es gratis y abierto, "
            "pero para que el equipo la comparta alguien del equipo se tiene que volver "
            "administrador de servidores. Con nosotros no ves un servidor. Nunca. <b>Ésa es la "
            "venta.</b>",
    "nota":"No leas la tabla: señalá la última columna y explicá esa. Si te tiran que el competidor "
           "tiene 6.450 estrellas, la respuesta es que las estrellas no le operan el servidor a "
           "nadie."},
   {"s":"09 · Equipo","seg":25,
    "texto":"Lo construimos porque lo necesitábamos nosotros. Gerónimo es el CEO, yo soy el CTO y "
            "Bautista es el CMO. Somos los primeros usuarios: cuatro asistentes en paralelo, todos "
            "los días. Y no lo probamos sólo con nuestro producto: hacemos software "
            "para clientes arriba de Nest. Hace meses que esto viene funcionando <b>en las máquinas "
            "de otra gente</b>, no en la nuestra.",
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
