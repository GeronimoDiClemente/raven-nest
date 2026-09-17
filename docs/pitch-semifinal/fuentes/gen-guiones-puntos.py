# -*- coding: utf-8 -*-
import io, html

G = {
 "geronimo": {
  "nombre": "Gerónimo Di Clemente", "rol": "CEO",
  "bloques": [
   {"s":"01 · Portada","seg":10,
    "idea":"Qué es Nest, en una línea.",
    "puntos":["El terminal donde tu equipo <b>ya</b> corre sus agentes.",
              "Por eso es donde puede vivir su memoria.",
              "Nada más. No expliques el producto todavía."]},
   {"s":"02 · El problema","seg":20,
    "idea":"El tiempo que se pierde repitiendo lo mismo.",
    "puntos":["Ejemplo propio: <b>5 personas × 4 agentes = 20 memorias</b> separadas, cero conexión.",
              "Compartimos el repo; no compartimos lo que los agentes aprendieron.",
              "Dato externo: Stack Overflow 2024, n≈65.000 → <b>61 % pierde +30 min/día</b>.",
              "Hablá de tiempo perdido, no de “contexto”."]},
   {"s":"03 · La solución","seg":20,
    "idea":"No es que guardamos memoria: es dónde estamos parados.",
    "puntos":["Nest corre los agentes → ve el pane, la rama, el diff, los tests y quién estaba.",
              "Los demás dependen de que el agente <b>decida</b> guardar.",
              "La memoria se llena sola porque estamos abajo del agente."],
    "pase":"Pasás a Bauti: el loop andando."},
   {"s":"10 · Plan · 12 meses","seg":12,
    "idea":"Doce meses, todos de Memories.",
    "puntos":["Mes 1-3: <b>plugin suelto</b> — anda con Claude Code, Codex o Gemini CLI sin Nest.",
              "Mes 4-6: <b>llave de cifrado del equipo</b> — destraba a los que hoy no subirían nada.",
              "El terminal ya está hecho: es la puerta, no el trabajo."],
    "pase":"Venís de Mati. Retomás vos."},
   {"s":"11 · El pedido","seg":13,
    "idea":"Un solo pedido, concreto.",
    "puntos":["Contactos con <b>10 equipos de 5+ devs</b>, en 90 días.",
              "Para medir cuántos pasan de local gratis a nube paga.",
              "<b>nestmux.com</b> — se baja hoy.",
              "Cerrar con “y pasar a la final”."]},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Lo pedís vos en el slide 11. Respuesta corta: si quieren el detalle, lo tiene Bauti.",
   "puntos": [
    "Un equipo de <b>5+ devs</b> que usa Nest como su terminal <b>90 días</b>.",
    "Arranca local y gratis. A los 30 días activan Memories de equipo, plan Cloud sin cargo.",
    "<b>Día 91 deciden si pagan</b> — eso es exactamente lo que medimos.",
    "No buscamos los US$ 500 al mes: buscamos la <b>tasa de conversión</b> de gratis a pago.",
   ]},
  "preguntas":[
   ("¿Por qué no lo hace GitHub o Microsoft?",
    "Copilot Memory ya existe: es personal, no de equipo, y olvida a los 28 días. El problema no es el motor, es la operación."),
   ("¿De dónde salen los 400 equipos del SOM?",
    "400 × 5 asientos pagos = 2.000 asientos, a 3 años, sobre el precio anual (el más bajo)."),
  ]},

 "bautista": {
  "nombre": "Bautista Martínez Vuoto", "rol": "CMO",
  "bloques": [
   {"s":"04 · El loop","seg":20,
    "idea":"Ya está cerrado en el código, no en el slide.",
    "puntos":["<b>Entra</b>: ticket de GitHub, Jira o Linear —o Slack— abre el worktree y levanta el agente.",
              "<b>Trabajan</b>: cada uno en su pane, su rama y su rol.",
              "<b>Queda</b>: el reviewer marca un problema y la memoria se escribe con procedencia — ticket, rol, ronda, autor.",
              "El remate: <b>nadie la escribió</b>."],
    "pase":"Arrancás vos, después de Gero. Enganchá directo, sin presentarte."},
   {"s":"05 · Mercado","seg":18,
    "idea":"De abajo hacia arriba y sobre el precio más bajo.",
    "puntos":["US$ 96 por asiento al año — el anual, no el de lista.",
              "TAM 1.728 M · SAM 74,9 M · <b>SOM 192.000</b>.",
              "Decí sólo el SOM y por qué se defiende: 400 equipos × 5 asientos.",
              "No leas las tres cajas: ya están en pantalla."]},
   {"s":"06 · Modelo","seg":17,
    "idea":"El volumen es la puerta; la memoria compartida es el cobro.",
    "puntos":["US$ 10 por asiento/mes, US$ 8 si pagan el año.",
              "Un dev solo: <b>gratis y sin límite de tiempo</b>.",
              "Se paga recién cuando quiere que el equipo vea esa memoria.",
              "Recurrente desde el primer equipo que entra."],
    "pase":"Pasás a Mati: qué hay construido."},
  ],
  "definicion": {
   "titulo": "Qué es un piloto",
   "sub": "Lo introducís vos en el slide 06. Si lo preguntan, es tuyo.",
   "puntos": [
    "Un equipo de <b>5+ devs</b> sobre un repo compartido, que usa Nest como su terminal <b>90 días</b>.",
    "<b>Días 1-30, local:</b> instalan gratis y trabajan. La memoria se llena sola, pero es de cada uno.",
    "<b>Días 31-90, equipo:</b> activan Memories en la nube, plan Cloud sin cargo durante el piloto.",
    "<b>Día 91:</b> deciden si pagan los US$ 10 por asiento.",
    "Nosotros ponemos el Cloud gratis y el onboarding; ellos, uso real y una call de 30 min al cierre.",
    "<b>Medimos:</b> cuántos activan la memoria de equipo · cuánto se escribió solo vs a mano · <b>cuántos siguen pagando el día 91</b>.",
    "<b>Por qué 10 y 90 días:</b> 50 asientos son US$ 500/mes — no es la plata, es la tasa de conversión. En 2 semanas no hay memoria acumulada que pruebe nada.",
   ]},
  "preguntas":[
   ("¿Por qué tan barato?",
    "Es deliberado: queremos el equipo entero adentro, no un dev suelto pagando caro."),
   ("¿De dónde sale el 60 %?",
    "Stack Overflow Developer Survey 2024, n≈65.000 devs."),
   ("¿Y si no convierten de gratis a pago?",
    "Es justo lo que vamos a medir con los 10 pilotos en 90 días. Por eso el pedido es ése y no plata."),
  ]},

 "matias": {
  "nombre": "Matías Labari", "rol": "CTO",
  "bloques": [
   {"s":"07 · Tracción","seg":16,
    "idea":"Está corriendo, no es un plan.",
    "puntos":["~100 usuarios activos con actualización automática.",
              "2 equipos desarrollando producto de clientes sobre Nest.",
              "v1.5 firmada en macOS, Windows y Linux · <b>2.388 tests</b>.",
              "Servicio de sincronización en producción, con backups y cuotas por equipo."],
    "pase":"Venís de Bauti. Rápido y seco, sin adornos."},
   {"s":"08 · Competencia","seg":20,
    "idea":"Todos resuelven el motor. Ninguno resuelve la operación.",
    "puntos":["CLAUDE.md / AGENTS.md: a mano, vos, en cada repo.",
              "Copilot Memory: se llena sola, pero es personal y olvida a los 28 días.",
              "Engram: 6.450 ★ y cero hosting → alguien del equipo se vuelve sysadmin.",
              "Nest: la operamos nosotros, vos no ves un servidor.",
              "La columna que ganás es <b>¿quién la administra?</b>"]},
   {"s":"09 · Equipo","seg":14,
    "idea":"Quiénes somos y por qué nosotros.",
    "puntos":["Los tres con nombre y rol: Gerónimo CEO, vos CTO, Bautista CMO.",
              "Cuatro agentes en paralelo todos los días.",
              "Desarrollamos software de terceros sobre Nest.",
              "Lo difícil ya lo operamos hace meses."],
    "pase":"Pasás a Gero: el plan y el cierre."},
  ],
  "preguntas":[
   ("¿Qué pasa si Engram saca hosting mañana?",
    "Seguimos teniendo lo que no pueden copiar: corremos los agentes. La captura pasiva depende de estar abajo del agente, no del motor."),
   ("¿Cómo garantizan la privacidad?",
    "Cifrado del lado del cliente. La llave es del equipo: ni un admin nuestro con acceso a la infra lee una memoria."),
   ("¿Dónde está la prueba del loop?",
    "<code>electron/integrations/memory-bridge.ts</code>: el bus de eventos traduce el grafo de agentes a escrituras de memoria, con procedencia."),
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
.pie{margin-top:5px;font-size:7.5pt;color:#8b9a93;border-top:1px solid #dfe5e2;padding-top:4px;
     display:flex;justify-content:space-between;gap:12px;}
"""

for key, g in G.items():
    seg = sum(b["seg"] for b in g["bloques"])
    nums = ", ".join(b["s"].split(" · ")[0] for b in g["bloques"])
    out = ['<meta charset="utf-8">',
           "<title>%s · qué dice</title>" % html.escape(g["nombre"]),
           "<style>%s</style>" % CSS,
           '<div class="head"><div><div class="q">%s</div>'
           '<div class="r">%s · pitch semifinal UCAECE</div></div>'
           '<div class="t">Slides %s<br><b>%s s</b> de 180 s'
           '<div class="nota">Son puntos, no un texto:<br>decilo con tus palabras.</div></div></div>'
           % (html.escape(g["nombre"]), g["rol"], nums, seg)]
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
print("TOTAL:", sum(sum(b["seg"] for b in g["bloques"]) for g in G.values()), "s")
