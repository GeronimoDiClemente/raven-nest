# -*- coding: utf-8 -*-
import io, html

GENTE = {
 "geronimo": {"nombre":"Gerónimo Di Clemente", "rol":"CEO", "slides":"01, 02, 03, 10, 11",
  "bloques":[
   {"s":"01 · Portada","seg":10,
    "texto":"Buenas. Somos Nest. Tu equipo ya corre agentes de IA todos los días: nosotros somos "
            "la terminal donde los corre. Y por eso, donde su memoria puede quedarse.",
    "nota":"Arrancá parado y mirando al jurado. Estos diez segundos deciden si te escuchan el resto."},
   {"s":"02 · El problema","seg":20,
    "texto":"Te lo cuento con lo que nos pasa. Somos cinco, y cada uno labura con cuatro agentes: "
            "veinte memorias separadas que no se hablan. Compartimos el repositorio, pero nada de "
            "lo que esos agentes aprendieron. Y no es sólo nuestro: seis de cada diez devs pierden "
            "media hora por día buscando algo que el equipo ya resolvió.",
    "nota":"El dato es de Stack Overflow, 65.000 devs — está en el slide, no hace falta que lo "
           "digas salvo que quieras apoyarlo."},
   {"s":"03 · La solución","seg":20,
    "texto":"Y acá está la diferencia. No es que nosotros guardamos memoria y los demás no: es "
            "<b>dónde estamos parados</b>. Nest corre los agentes, así que ve la rama, el diff, qué "
            "tests pasaron y quién estaba. El resto depende de que el agente se acuerde de guardar. "
            "Nosotros no le preguntamos a nadie.",
    "nota":"Bajá el ritmo en «dónde estamos parados». Es la idea que tienen que llevarse.",
    "pase":"Te paso con Bauti, que te muestra el loop andando."},
   {"s":"10 · Plan · 12 meses","seg":12,
    "texto":"Doce meses, todos de Memories. Primero soltamos el plugin, para que la memoria funcione "
            "con Claude Code, Codex o Gemini aunque no uses Nest. Y después, la llave de cifrado del "
            "equipo.",
    "nota":"Retomás vos después de Mati. Enganchá sin presentarte de nuevo."},
   {"s":"11 · El pedido","seg":13,
    "texto":"Lo que necesitamos son contactos. Diez equipos de cinco devs o más, noventa días, para "
            "medir cuántos pasan de local gratis a nube paga. Nest está en <b>nestmux.com</b>, lo "
            "pueden bajar hoy. Y pasar a la final. Gracias.",
    "nota":"Frená antes de «y pasar a la final». Es el remate y necesita el silencio de antes."},
  ],
  "piloto":["Un equipo de <b>5+ devs</b> que usa Nest como su terminal <b>90 días</b>.",
            "Arranca local y gratis. A los 30 días activan Memories de equipo, plan Cloud sin cargo.",
            "<b>Día 91 deciden si pagan</b> — eso es exactamente lo que medimos.",
            "No buscamos los US$ 500 al mes: buscamos la <b>tasa de conversión</b> de gratis a pago.",
            "Si quieren el detalle fino, lo tiene Bauti."]},

 "bautista": {"nombre":"Bautista Martínez Vuoto", "rol":"CMO", "slides":"04, 05, 06",
  "bloques":[
   {"s":"04 · El loop","seg":20,
    "texto":"Esto no es un mockup, ya está andando. Entra un ticket de GitHub o un mensaje en "
            "Slack, y eso solo abre la rama y levanta al agente. Los agentes trabajan, cada uno en "
            "lo suyo. Y cuando un reviewer marca un problema, la memoria <b>se escribe sola</b>: "
            "con el ticket, el rol, la ronda y quién fue.",
    "nota":"Arrancás vos después de Gero. Enganchá directo, no te presentes de nuevo. "
           "Si te preguntan dónde está eso, el archivo es memory-bridge.ts."},
   {"s":"05 · Mercado","seg":18,
    "texto":"El mercado lo calculamos de abajo hacia arriba, y sobre nuestro precio más bajo: "
            "noventa y seis dólares por asiento al año. El total da mil setecientos veintiocho "
            "millones. Pero el número que defendemos es el de abajo: <b>ciento noventa y dos mil</b>, "
            "que son cuatrocientos equipos de cinco asientos.",
    "nota":"No leas las tres cajas: están en pantalla. Decí el chico y por qué se sostiene — "
           "que sea el conservador juega a favor."},
   {"s":"06 · Modelo","seg":17,
    "texto":"Diez dólares por asiento al mes, ocho si pagan el año. Un dev solo lo usa gratis, sin "
            "límite: esa es la puerta de entrada. Se paga recién cuando quiere que el equipo vea su "
            "memoria. <b>El volumen nos trae la gente; la memoria compartida es lo que cobramos.</b>",
    "nota":"La última frase es tu remate. Decila más lento que el resto.",
    "pase":"Te paso con Mati, que te cuenta qué hay construido."},
  ],
  "piloto":["Un equipo de <b>5+ devs</b> sobre un repo compartido, que usa Nest como su terminal <b>90 días</b>.",
            "<b>Días 1-30, local:</b> instalan gratis y trabajan. La memoria se llena sola, pero es de cada uno.",
            "<b>Días 31-90, equipo:</b> activan Memories en la nube, plan Cloud sin cargo durante el piloto.",
            "<b>Día 91:</b> deciden si pagan los US$ 10 por asiento.",
            "Nosotros ponemos el Cloud y el onboarding; ellos, uso real y una call de 30 min al cierre.",
            "<b>Medimos:</b> cuántos activan la memoria de equipo · cuánto se escribió solo vs a mano · <b>cuántos siguen pagando el día 91</b>.",
            "<b>Por qué 10 y 90 días:</b> 50 asientos son US$ 500/mes — no es la plata, es la tasa de conversión. En 2 semanas no hay memoria acumulada que pruebe nada."]},

 "matias": {"nombre":"Matías Labari", "rol":"CTO", "slides":"07, 08, 09",
  "bloques":[
   {"s":"07 · Tracción","seg":16,
    "texto":"Esto no es un plan, está corriendo hoy. Cien usuarios activos. Dos equipos que "
            "desarrollan producto de clientes arriba de Nest. La versión uno cinco, firmada en Mac, "
            "Windows y Linux. Y el servicio de sincronización ya está en producción, con backups.",
    "nota":"Venís de Bauti. Este bloque es tu credibilidad: decilo seco, sin adornar. "
           "Si preguntan por los tests, son 2.388."},
   {"s":"08 · Competencia","seg":20,
    "texto":"Todos resuelven el motor de memoria. <b>Ninguno resuelve la operación.</b> Un CLAUDE.md "
            "lo mantenés vos, a mano. Copilot Memory se llena sola, pero es personal y olvida a los "
            "veintiocho días. Engram es el más parecido a nosotros, pero no tiene hosting: para "
            "tener memoria de equipo, alguien del equipo se vuelve sysadmin. Con nosotros no ves "
            "un servidor.",
    "nota":"Si te van a repreguntar algo, es acá. La columna que ganás es «¿quién la administra?». "
           "Engram tiene 6.450 estrellas, por si te tiran el número."},
   {"s":"09 · Equipo","seg":14,
    "texto":"Lo construimos porque lo necesitábamos nosotros. Gerónimo es el CEO, yo soy el CTO y "
            "Bautista es el CMO. Trabajamos con cuatro agentes todos los días y hacemos software "
            "para clientes arriba de Nest. Lo difícil ya lo venimos operando hace meses.",
    "nota":"Nombrá a los tres sin apurarte: es la parte que el jurado marcó como floja.",
    "pase":"Te devuelvo con Gero, que cierra con el plan."},
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
.txt{font-family:Georgia,"Times New Roman",serif;font-size:13pt;line-height:1.55;}
.txt b{color:#0a4a34;}
.nota{margin-top:6px;font-size:8.5pt;color:#6b7a73;border-left:2px solid #c9d5d0;padding-left:9px;line-height:1.4;}
.pase{margin-top:5px;font-family:Georgia,serif;font-size:10.5pt;color:#0F5E42;font-style:italic;}
.def{margin-top:10px;background:#f2f7f5;border:1px solid #cfe0d8;border-radius:5px;padding:9px 11px;break-inside:avoid;}
.def h2{font-size:8.5pt;margin:0 0 6px;color:#0F5E42;letter-spacing:.14em;text-transform:uppercase;}
ul{margin:0;padding-left:16px;}
.def li{font-size:9pt;line-height:1.38;margin-bottom:2px;}
"""

for key, g in GENTE.items():
    seg = sum(b["seg"] for b in g["bloques"])
    pal = sum(len(b["texto"].replace("<b>", "").replace("</b>", "").split()) for b in g["bloques"])
    out = ['<meta charset="utf-8">',
           "<title>%s · para aprender</title>" % html.escape(g["nombre"]),
           "<style>%s</style>" % CSS,
           '<div class="head"><div><div class="q">%s</div>'
           '<div class="r">%s · pitch semifinal UCAECE</div></div>'
           '<div class="t">Slides %s<br><b>%s s</b> de 180 s<br>%s palabras · ~%.1f por segundo'
           '<div class="nota">Para aprendértelo.<br>En el escenario usá el de puntos.</div>'
           '</div></div>' % (html.escape(g["nombre"]), g["rol"], g["slides"], seg, pal, pal / seg)]
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
