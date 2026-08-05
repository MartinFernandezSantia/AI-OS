# Preguntas pendientes a TG — consolidado

> Única fuente de verdad de lo que falta preguntarle a TG (sesiones hasta 2026-07-24;
> Martin resolvió un lote grande el 2026-07-24, ver tabla de abajo).
> Ideal: UNA sola conversación. **Criterio transversal:** cada respuesta aterriza como
> DATO (producto nuevo, sinónimo/display en el overlay, o línea de Info del negocio),
> nunca como regla nueva de prompt.
> Al final: lo ya resuelto (para no re-preguntar) y los temas comerciales a avisar.
> Los números NO son correlativos (se conservan los originales para no romper referencias
> en planes/decisiones; los resueltos se sacaron de acá y viven en la tabla del final).

## 1. Gates del catálogo limpio (bloquean partes del go-live del dedupe)

1. **¿El papel obra de 75 gr (el de las impresiones comunes) es A4? ¿Hay otros
   tamaños?** — Gate del renombre de la zona sucia. Decisión ya tomada si la
   respuesta es sí: el display pasa a "Impresiones a4 papel obra 75 gr" y los
   sinónimos de a4 se duplican en 75 y 106 (nunca quedan en uno solo).
4. **Papel obra 106: ¿cuándo va por laser ($800/hoja) y cuándo por Riso/inkjet
   (tabla desde $180)?** — Son dos productos con precios muy distintos (en el export
   figuran "Impresión a4 Papel obra de 106 gr" y "OBRA 106 GR") y el cliente dice
   "papel obra de 106" para ambos.

## 2. Directas de catálogo

5. **Medios de pago y seña** — ¿Mercado Pago? ¿tarjetas? ¿piden seña? ¿transferencia?
   (consulta frecuente; hoy escala siempre). → Info del negocio.
6. **¿Los imanes se venden al público?** — El producto Iman existe con tabla de
   cantidad. Si no es de público, se oculta en el overlay.
7. **Sobres ingleses duplicados en el sistema** (Librería $500 vs Soportes
   Especiales $0 + tabla) — ¿unidad vs pack? ¿cuál va? → se oculta o renombra uno.
9. **¿Hacen pasacalles?** — Si sí, entra como sinónimo de lona; si no, sigue
   derivando a humano.
38. **"Vinilo, Lona Brillo/Mate Uv" — ¿se imprime en lona además de vinilo?**
    (ninguna variante lo refleja). El precio por metro LINEAL ya quedó resuelto
    (medida sin exacto → lineal o m² según el producto). Sólo queda esta parte.

## 3. Servicios implícitos (TG los calcula internamente y no están cargados)

Para cada uno: ¿lo hacen?, ¿cómo se calcula? (¿= valor impresión?, ¿por hoja?,
¿por unidad?) y ¿desde cuántas unidades?

12. **Fotocopias b/n y color** — LA consulta #1 del mostrador; hoy escala siempre.
13. **Escaneo / digitalización** — ¿por hoja? ¿lo mandan por mail al cliente?
15. **Plegado / doblado** (trípticos) — pega con Folletos.
16. **Empastado / tapa dura** (tesis de posgrado) y **termoencuadernado**.
22. **Guillotinado / corte chico suelto** — el producto Corte x Millar es por mil;
    ¿y cortar 20 hojas?

## 4. Segunda línea (solo si la reunión da)

24. Diseño/ajuste de archivo. 25. Talonarios AFIP.
26. Transparencias/filminas. 27. Papel fotográfico. 28. Mapas/planos plegados.
40. "Papel Autoadhesivo Brillo / Split": ¿qué es "Split"? (pasada 1).
41. "Papel Obra Vegetal Color/Negro" (ploteo): ¿es papel obra y/o vegetal? (pasada 1).

## 5. Material a pedir

30. ~~Foto de la lista de precios del mostrador~~ — **RESUELTA 2026-07-23, ver
    tabla de abajo**: no va a existir; la fuente viva es el sistema quote-automation.

## 6. Cotizador v7 (bloquean los TOTALES del bot — plan `plans/faq-bot-v7-cotizador.md`)

32. **Práctica de carga con copias** — para N copias de un documento de P páginas,
    ¿el mostrador carga UN ítem con N×P impresiones (bracket del total) o carga por
    copia? Hoy el bot usa un techo conservador que nunca sub-cotiza; con la
    respuesta pasa a total exacto.
34. **Formato de los apuntes/módulos de medicina** — la única variante cargada es
    "Impresion a4 s/f color" ($45/página). ¿Es el único formato en que se imprimen
    (siempre a4, siempre simple faz, siempre color)? ¿O existen b/n, doble faz u
    otros tamaños con precio especial de medicina que faltan cargar? (El ALCANCE ya
    quedó resuelto: solo material de medicina; esto pregunta por el FORMATO.)
37. **"Sobre Inglés" figura dos veces** — uno a $500 (rubro Librería) y otro a
    $0 (rubro Soportes Especiales). ¿El de $0 es un duplicado viejo para borrar?
    Mientras tanto lo ocultamos (curación 1c) para que no salga un menú con un
    ítem a $0; si es un producto vivo se revierte. *(2026-07-27: confirmado en el
    export nuevo que son **dos filas distintas** en `public.products`, no un error
    de lectura. El ocultamiento sigue en pie y la pregunta también.)*
63. **Doble faz: ¿cómo lo calculan?** — El bot va a tener que hacer esta cuenta
    solo, así que necesitamos que lo confirmen ustedes y no deducirlo de la lista.
    (a) El precio unitario cargado para doble faz, ¿es **por hoja** (las dos caras
    juntas) o **por página** (cada cara)? (b) Cuando alguien trae un documento de
    200 páginas para imprimir doble faz, ¿qué cargan en el sistema: 100 hojas al
    precio de doble faz, o 200 al de simple? (c) Si el documento tiene páginas
    impares (201), ¿cobran 101 hojas? — **Por qué importa:** en obra 75, simple
    faz b/n $100 y doble faz b/n $150. Si el precio es por hoja, 200 páginas salen
    $17.600; si fuera por página, $35.600. Es un 2× de diferencia en cada
    presupuesto de apuntes. Martin ya lo resolvió por inferencia (por hoja, porque
    1,5× y no 2× solo cierra si el precio es de la hoja) y el motor se va a
    construir así; esto es la confirmación. Pega con la 32 (práctica de carga con
    copias).

## 9. Ronda 4 de suites + consejo Opus (2026-07-25)

52. **Unidad de venta del resto del catálogo.** En el sistema, 148 de 180 variantes
    tienen "Hoja" como unidad, incluidas lonas, carteles y porta banners. ¿Cuáles se
    venden de verdad por hoja y cuáles por trabajo, por metro o por unidad? (Anillado,
    encuadernado y refilado ya los cerró Martin: por trabajo. Falta el resto.)
60. **Mínimo de m² / metro.** El precio del m² es más barato que el de todas las
    medidas chicas listadas (en PVC el m² sale $46.000 y el cartel de 35×50 cm sale
    $20.000, que al ritmo del m² daría $8.050). ¿Desde qué medida se cobra por m²?
    ¿Hay un mínimo de superficie o un precio piso para trabajos chicos?
61. **Por metro lineal.** Laminado y encapsulado por metro, bolsillos de banner y el
    vinilo UV: ¿hay mínimo de metros? ¿El precio por metro cambia según el ancho?
    (Define si el bot puede hacer la cuenta de metros × precio o solo pasar el precio.)
62. **Ancho máximo por material.** La lona brillo dice 1,52 m. ¿Cuál es el ancho máximo
    de cada material, y qué pasa cuando el trabajo lo supera (paños y costura)? El bot
    necesita saberlo para no cotizar por superficie algo que no entra.
59. **OPP y los papeles especiales** — ¿"OPP Brillo" y "OPP
    Mate/Holográfico/Plata/Crystal/Glitter/Kraft" son impresiones sobre ese papel o el
    papel suelto? ¿Y los acabados que lista el nombre valen todos lo mismo?
    **Ampliada (E0, 2026-07-26):** la misma pregunta vale para el rubro entero —
    kraft 130/300, vegetal y autoadhesivo están en *Soportes Especiales*, que cuelga
    de LASER y tiene los mismos precios que la impresión láser (kraft A4 $800 = obra
    106 A4 $800). ¿Son los cuatro impresiones sobre ese papel? (Provisional: se tratan
    como impresiones y los acabados del nombre como equivalentes al mismo precio.)
53. **Anillado** — ¿Cómo eligen el anillo en el mostrador? ¿Por cantidad de hojas?
    Pasame la referencia que usan (hasta cuántas hojas entra cada medida: hasta 3/4,
    1", 1"1/8, 1"1/4, 1"1/2). (El precio ya quedó por trabajo, decisión de Martin.)
54. **Packs de tarjetas** — Arriba de 1000, ¿siguen sumando packs o lo cotizan aparte?
    (Lo demás resuelto: no se cobra extra por armar dos packs, y qué mostrarle al
    cliente lo decidió Martin — los dos tiers con precio, después de la variante.)
55. **Promo inmobiliarias** — Llevando 7 u 8 carteles, ¿los que pasan de 6 también van
    a $15.000 o vuelven a $19.500? ¿Y la promo es solo para inmobiliarias?
56. **Talonarios** — "Rifas 100 números": ¿el precio cargado es por talonario de 100 o
    por rifa? Si alguien pide 500 rifas, ¿son 5 talonarios?
57. **Tacos** — Están cargados en 3 tamaños por color y negro. Cuando alguien pide "un
    taco", ¿qué le preguntan primero, el tamaño o el color?
58. **Carteles corrugado** — El de 1×0,65 a $19.500, ¿se vende suelto al público o solo
    dentro de la promo? Y las medidas 1×1 / 2×1 / a3, ¿son fijas o cortan a medida?

## 10. Atomización del catálogo (E0, 2026-07-26)

Las tres salieron de comparar atributos entre productos: son pares que quedaron
**idénticos** o con precios que no cierran. El bot no puede distinguirlos solo.

64. **¿"Cartón" y "Montado sobre cartón" son lo mismo?** — Tienen las mismas 5 medidas
    pero distinto precio: el 100×70 sale $3.200 en *Cartones* y $6.500 en *Encartonado*.
    ¿El primero es el cartón crudo (lo vendo y me lo llevo) y el segundo el servicio de
    montar una impresión sobre cartón? (Provisional: se cargó así, con una marca de
    "servicio" en el segundo.)
65. **Las dos cartelerías de PVC tienen el MISMO precio** — "c/ Papel obra 130 gr" y
    "c/vinilo brillo/mate" cuestan exactamente igual en las 6 medidas ($42.000 el
    100×70, $20.000 el 35×50, $46.000 el m²…). ¿Es correcto que valgan lo mismo, o
    quedó una sin actualizar? Si es correcto: ¿en qué caso conviene cada una?
66. **"Corte x Millar": ¿"millar" es el pack?** — Está cargado a $5.000. ¿Ese precio es
    por 1.000 cortes (o sea, alguien que pide 500 cortes paga igual $5.000), o es por
    corte y el "millar" es otra cosa? Hoy el bot lo trata como pack y **no multiplica**,
    que es la conducta segura; si es por corte estaría sub-cotizando. Pega con la 22
    (guillotinado / corte chico suelto).

## 11. Ronda completa de 16 mensajes (2026-07-27)

67. **La escala de rifas: ¿el número es el total del trabajo o el precio por talonario?** —
    *Talonarios Rifas 100 numeros* tiene una escala que **sube** con la cantidad: 100 → $6.000,
    250 → $8.000, 500 → $10.000, 1.000 → $14.000, 5.000 → $29.000, 10.000 → $32.000. Un precio
    unitario no sube por volumen, así que asumimos que **cada número es el total de esa cantidad**
    y el bot dejó de decir "c/u" (antes decía "100 a 101: $6.000 c/u", que leído literal son
    $600.000 por 100 rifas). Confirmar. Y de paso: los tramos están cargados como `[n, n+1]`
    (100 a 101, 250 a 251…), o sea **puntos sueltos**: ¿qué se cobra por 300, que no cae en
    ninguno? Hoy el bot muestra la escala entera y no elige.
68. **`Anillado Plastico a3`: su única variante se llama `A4`.** — *Ya no bloquea: curado a **A3**
    el 2026-07-27.* El nombre del producto y el atributo `tamano` curado dicen los dos a3, contra
    el nombre de la variante — dos fuentes independientes contra una, que es la regla de variante
    única. Queda sólo como **confirmación**: si TG dice que el A4 era el dato bueno, se revierte.
    Mismo caso en `A5 ILUST. MATE 250 GR`, cuya única variante también decía `A4` contra un
    producto y un atributo que dicen a5 (curada a **A5**).
69. **¿Cómo pide un cliente el `Microperforado` y el `Lineal obra 90 gr Color/Negro`?** — Son dos
    de los seis productos que hoy **no se encuentran** si el cliente no conoce el término técnico:
    nadie escribe "microperforado" ni "lineal obra 90" sin saber de antemano que existen. Necesito
    las palabras que usa la gente en el mostrador para cargarlas como sinónimos. No las invento yo
    porque no están en el dato. (El resto de los invisibles se resolvió el 27 metiendo el
    sustantivo en el display — ver `db/curacion-2026-07-27.md`.)

## 12. Defaults de familia — "el trabajo normal" (2026-07-28)

Aplica la regla ya firmada en *Defaults de oficio* (§Ya resuelto): si la familia tiene un
default curado, el bot cotiza ese y ofrece el resto en la misma frase — **nunca un default
silencioso**. Esto extiende el mecanismo a 3 familias más. Ninguna de las cuatro bloquea:
si TG corrige una, se mueve el flag y el mecanismo no cambia. Aplicadas en
`db/curacion-2026-07-28.sql`.

70. **Impresiones: ¿el trabajo normal es obra 75 gr en A4?** — Ya estaba firmado el papel
    (obra 75, simple faz, b/n). Lo que se agrega es el **tamaño**: el producto no declaraba
    ninguno, y sin ese dato el bot no puede detectar que un pedido de A3 no le corresponde
    (cotizaba $400/hoja cuando el A3 real vale $1.200-1.800). Se cargó `tamano: ["a4"]`
    asumiendo que del riso sale A4. **Confirmar que el riso no imprime otro tamaño.**
71. **Anillado: ¿el normal es el plástico A4/oficio ($2.400)?** — Decisión de Martin
    2026-07-28. Ante "anillame un apunte" sin más datos, el bot cotiza plástico y menciona
    el metálico ($3.200-4.600). Confirmar que el plástico es lo que se pide por defecto en
    el mostrador.
72. **Plastificado: ¿el normal es `Laminados` ($330 A4 / $600 A3)?** — Hoy, ante
    "plastificame esto", el bot elegiría `Plastificado A4` a **$2.200** — 6,7× más caro.
    Necesito saber cuál es el trabajo que la gente pide cuando dice "plastificar" a secas,
    y **cuál es la diferencia real entre `Laminados`, `Plastificado A4` y `Encapsulado`**,
    porque por el nombre no se distingue y el precio dice que no son lo mismo.
73. **Librería: ¿el sobre normal es el A4 ($700)?** — El más flojo de los cuatro. Ante
    "necesito un sobre" el bot cotizaría A4; podría ser el inglés ($500) si la gente los
    pide para carta. Confirmar cuál se vende más.

## 13. Recargos del UV — el total ya sale, falta la variante (2026-07-31)

Hasta hoy el bot **nunca** daba el total de un producto UV: decía el precio por metro y
mandaba el total a mail. La razón era que el precio cargado es el **base** y el recargo lo
pone el taller, así que multiplicar sub-cotizaba. Martin levantó ese bloqueo el 2026-07-31:
el cliente que pregunta "cuánto sale una lona de 3x2" tiene que recibir el número, y hoy se
iba a mail teniendo el dato.

**Lo que eso deja abierto:** el total que sale ahora es el del trabajo **sin adicionales**.
Si el cliente pide UV exterior, UV blanco o barniz UV, el precio real es más alto y el bot
no lo sabe — cotizaría de menos con confianza. No bloquea el go-live (el caso normal es sin
adicional), pero es deuda con plata adentro.

74. **¿Cuánto es el recargo de cada adicional UV?** — Los tres que Martin nombró: **UV
    exterior**, **UV blanco** y **barniz UV**. Para cada uno: ¿es un porcentaje sobre el
    precio base, un monto fijo por m², o un precio propio? ¿Se pueden combinar (exterior +
    blanco en el mismo trabajo)?
75. **¿Van como variantes del producto o como adicional aparte?** — Si cada combinación es
    una variante con su propio precio, el bot las cotiza exacto sin tocar el motor (es el
    camino preferido). Si es un recargo que se aplica sobre cualquier lona, hace falta
    modelarlo distinto. La respuesta decide si esto es carga de catálogo o desarrollo.
76. **Mientras tanto, ¿el total sin adicionales se puede afirmar?** — O sea: un cliente que
    pide "lona brillo UV 3x2" y no menciona ningún adicional, ¿paga el precio base × los
    metros? Si la respuesta es no (siempre hay algún recargo), hay que volver a poner el
    gate — ver `n8n/flows/faq-bot-v10-live.json`, nodo `Calcular Montos`, el comentario
    "UV DESBLOQUEADO".

## 14. Ronda del 2026-07-31 (suite 8 sobre v10)

Dos datos de catálogo que la corrida real dejó abiertos. Detalle completo en
`tests/ronda-2026-07-31-hallazgos.md`.

77. **¿Para qué se usa el papel vegetal?** — El bot cotizó `papel vegetal a4 x10` a $1.000
    la hoja ($10.000 el total) y está bien. Pero si el vegetal es un **soporte de
    impresión**, tiene que aparecer entre las opciones cuando alguien pregunta por imprimir,
    y hoy no aparece. Si es otra cosa (calco, plantilla), saber cuál para no ofrecerlo mal.
78. **¿Los ojales son sólo para lona y plástico corrugado?** — Ante `cuánto salen los
    ojales?` el bot contestó *"los ojales para lonas o plástico corrugado los tenemos"*. La
    parte de que el **cómo se cobra** se confirma por mail es correcta (ojales no tiene
    `unidad_venta` decidida — es la pregunta 52). Lo que hay que confirmar es de dónde salió
    *"lonas o plástico corrugado"*: **si es un dato real del negocio, se carga; si no, el
    bot lo inventó** y es un confident-wrong sobre materiales.

## 15. Revisión v10-live (2026-08-05)

79. **¿Qué precio aplica cuando el cliente pide MÁS que el último tramo de una escalera por
    cantidad?** — Ejemplo real: **Imanes (impresión laminada y corte)** tiene tramos
    1-3 = $8.000, 4-10 = $7.200, 11-20 = $6.500 c/u, y la tabla **corta en 20**. Si un cliente
    pide **25 imanes**, no hay tramo cargado para esa cantidad. ¿Qué querés que cobre el bot?
    (a) el precio del último tramo (11-20 → $6.500 c/u), o (b) avisar que para esa cantidad el
    precio se confirma por mail (por si hay un descuento mayor no cargado). Hoy el bot cae al
    tramo 1 ($8.000, el más caro) y lo multiplica → sobre-cotiza ~1,23× con formato de "total
    cerrado". Se deja como está hasta que TG decida. Aplica a todo producto con escalera que
    termine en un tope (imanes y los demás que coticen por rangos de cantidad).

## 8. Rediseño de resolución (consejo 2026-07-24)

46. **Léxico de papeles especiales → producto real** — ¿Cómo mapea cada nombre que dice
    el cliente (obra 80, ahuesado, ilustración, etc.) al producto de stock, para
    disparar el fallback por NOMBRE y no por suerte de substring? (Causa de INC-15
    "obra 80 no ruteó"; es el insumo concreto de la limpieza de catálogo — ver
    resuelta "Auditoría de atributos".)
47. **% de cotizaciones fuera de la ventana de 24 h** — ¿Qué proporción de clientes
    retoma al otro día / fuera de la sesión de atención? Define cuántas plantillas
    humanas hay que preparar para que el bot no se caiga mudo. (Tarea de Martin /
    revisión de logs, NO es pregunta de mostrador.)

## 7. Temas comerciales para avisar (no son preguntas de catálogo)

- **Cobro de Meta por mensaje desde el 1-oct-2026**: cada respuesta del bot va a
  costar plata (rate AR se publica antes del 1-sep). La propuesta decía USD 0 de
  WhatsApp: avisar por escrito y acordar el pass-through.
- **Handoff asíncrono honesto**: TG no quiere gente mirando Chatwoot; el cambio
  (aviso honesto + email a TG en vez de takeover en vivo) es un CAMBIO DE ALCANCE
  vs lo vendido → formalizar por escrito.
- **SLA de reclamos**: definir con TG en cuánto tiempo responden un reclamo
  escalado (sin SLA no hay copy que salve al cliente enojado).

---

## Ya resuelto — NO re-preguntar

| Tema | Resolución |
|---|---|
| Plazos de entrega | No se informan; los confirma el equipo con el presupuesto (Martin, v10.7). Anillados exceptuados (el plazo es opción). |
| Envíos | No hay; se retira por el local (v10.7). |
| USB / celular en mostrador | Sí, como adicional; el email sigue primario (v10.7). |
| Medidas grandes | Solo productos por m²; nunca convertir ni confirmar factibilidad (v10.7). |
| ¿Precios de lista por WhatsApp? | Sí, excepto gremio (filtrado por construcción). Caveat neutro. (Martin, gate go-live.) |
| ¿Tabla completa o "desde $X"? | Tabla completa verbatim (Martin, v10.2). |
| Frescura de la lista | Se conecta al sistema diario del mostrador → check stale eliminado, queda airbag >90d (Martin, v10.7). |
| Espiralado / enmicado | Aplicados como sinónimos de anillado plástico / plastificado (decisión propia 2026-07-22; estándar rioplatense, no requiere a TG). |
| Cantidad-first | Preguntar cuántas y dar el bracket exacto; sin cantidad → tabla (Martin, v10.7). |
| Costo por página para libros | Sí, con "el precio final se cotiza vía mail" (Martin, v10.5). Compuestos excluidos de todo estimado con cantidad. |
| Escalación a humano | Siempre por **mail** (misma dirección, incluye reclamos y clientes enojados); no hay takeover en Chatwoot (Martin, 2026-07-24). La frase la modula el refinador según contexto. |
| Precio de medicina — alcance | SOLO para material de medicina; cualquiera puede pedirlo pero el precio especial solo aplica a medicina. La poda 'apuntes'=solo-medicina es correcta; el guard de nicho (pregunta si es medicina) queda (Martin, 2026-07-24). Falta el FORMATO → pregunta 34. |
| 106 gr: lista $120 vs tabla $180 | Siempre gana la tabla (Martin, 2026-07-24). |
| Papel vegetal x10 ($0) | Se ocultan (decisión del local) → `oculto=true` en `db/curacion-2026-07-24b.sql` (desambigua "papel vegetal" hacia el "Vegetal" vivo) (Martin, 2026-07-24). |
| Ploteo / impresión grande | No hay límite de medida; sin medida exacta se cobra por metro lineal o m² según diga el producto (Martin, 2026-07-24). |
| Ítems de taller (encuadernado, ojales, refilado…) | Se deja simple: se informa el precio del ítem aunque el cliente lo mencione en un trabajo combinado, pero NUNCA cómo se relaciona con otros ítems (Martin, 2026-07-24). |
| A5 ILUST. MATE 250 GR (variante "A4") | La variante "A4" es error de carga: es A5, no duplica a Ilustración Mate 250. Con mono-variante el display usa el nombre del producto (Martin, 2026-07-24). |
| Anillado Plástico a3 (variante "A4") | Es A3; con una sola variante se usa solo el nombre del producto, la "A4" se ignora (Martin, 2026-07-24). |
| Mono-variante → display | **REGLA GENERAL:** con una única variante, el nombre que vale es el del producto; ante datos contradictorios de la variante gana el nombre del producto (Martin, 2026-07-24). |
| Folios a4/oficio | Son fundas plásticas (Martin, 2026-07-24). |
| Diapositivas / PowerPoint | Se cobran como impresión: si una slide = una hoja, cada diapositiva va al precio de la impresión según gramaje y faz elegidos (Martin, 2026-07-24). |
| Tapas para anillados | No existen como producto (Martin, 2026-07-24). |
| Foto carnet | No; TG solo imprime, no saca fotos (Martin, 2026-07-24). |
| Impresión de fotos 10x15 / 13x18 | Sí, pero se cobra como la hoja de impresión (valores de impresiones) (Martin, 2026-07-24). |
| Póster académico A0/A1 | Según pida el cliente; salvo variante específica, va por m² (Martin, 2026-07-24). |
| Cómo llegan los archivos | USB, o el sistema propio del local para transferir desde el celu en el momento, o por celular; NO se aceptan archivos por WhatsApp (Martin, 2026-07-24). |
| Sellos | No se hacen (Martin, 2026-07-24). |
| Vinilo brillo (dos rubros) | Mostrar las opciones al cliente, sin default de mostrador (Martin, 2026-07-24). |
| "Adicional 106" / bookcel | No existen en el catálogo actual (verificado en el export). Era contexto viejo; "bookcel" es término del cliente sin producto → cae en sin_match (Martin + verificación, 2026-07-24). |
| Promo Inmobiliarias | Es POR CARTEL, exige llevar 6 (confirmado) → `por_pack=false` + display "(llevando 6)" en `db/curacion-2026-07-24b.sql`. Mínimo-6 y cuenta 6× = cotizador. ⚠️ **Corrección 2026-07-25 (consejo Opus):** el cartel suelto ($19.500) **sí se cotiza** — `mostrable` en la vista es `(not tiene_reglas)`, NO un flag de curación, y no lo lee ningún nodo Code. Ocultar de verdad es `oculto=true` en `variante_meta`. Además `por_pack=false` habilitó la multiplicación: "3 carteles" da $45.000 cuando el real es $58.500 → hace falta `min_unidades=6` (ver `plans/r7-refinador-y-resolucion.md` §1). Falta preguntar qué pasa entre 7 y 11 carteles (pregunta 55). |
| Anillado — sinónimos de urgencia | Nada de prometer tiempo, "el anillado es anillado y ya". → sinónimos de urgencia **sacados** en `db/curacion-2026-07-24b.sql` (24 hs + ocultos 48/72/96); "anillado urgente" → sin_match (Martin, 2026-07-24). |
| **Unidad del doble faz (ex-31)** | **Las impresiones se cobran POR HOJA** (Martin, 2026-07-26). En simple faz se cobra la hoja; en doble faz NO se cobra por página, porque el precio ya está ajustado a la hoja. Se ve en la lista: obra 75 simple faz b/n $100 y doble faz b/n $150, o sea la hoja impresa de los dos lados sale 1,5 veces la de un lado, no 2. **Consecuencia: `hojas = simple ? páginas : ceil(páginas/2)` por copia, el bracket se elige por hojas, y el gate que negaba el total del doble faz se levanta.** Sin esto un documento de 200 páginas a doble faz cotizaba el doble. ⚠️ **Resuelto por INFERENCIA, no por TG.** El motor se construye así, pero como el bot va a hacer la cuenta solo, la confirmación se pide en la **pregunta 63** (Martin, 2026-07-26). Si TG dice "por página", se vuelve a poner el gate. |
| **Papel por defecto** | **Obra 75 gr, simple faz, b/n** (Martin, 2026-07-26). Se muestra ese con la puerta abierta ("¿lo necesitás en color o en otro papel?"), nunca como default silencioso. Cierra la ex-pregunta 48. Riesgo anotado: si quería color, el b/n sub-cotiza 4× y lo tapa la puerta abierta, no el default. |
| **Packs de tarjetas — qué mostrar** | Primero se **confirma la variante** (los packs comparten variantes a precios distintos), y recién ahí, si la cantidad no cae en un tier, se muestran **el tier de abajo y el de arriba con sus precios**, aclarando que se trabaja por packs (Martin, 2026-07-26). Reemplaza "próximo tier hacia arriba". |
| **Extra por armar varios packs** | **No se cobra extra** (Martin, 2026-07-26). Lo que suele pasar es que por la diferencia de precio al cliente le conviene el tier de arriba: 3 packs de 100 son $36.000 y uno de 500 sale $28.000. El bot muestra las dos cuentas y decide el cliente. |
| **Anillado / encuadernado / refilado** | `unidad_venta = trabajo`: se informa el precio del ítem y **nunca se multiplica** por hojas ni por páginas (Martin, 2026-07-26). Cierra el bug V2. |
| Cuantización de pack | **SUPERSEDED por "Packs de tarjetas — qué mostrar" (2026-07-26).** La regla vieja era "próximo tier hacia arriba" (150 → el de 500, Martin 2026-07-24); el consejo Opus mostró que sobre-cotiza (150 simple faz: $28.000 contra $24.000 de 2×100; folletos ilustración 1500: 20% de más) y que la banda no es uniforme. |
| Defaults de oficio | **Actualizado 2026-07-26: hay default, con puerta abierta.** La regla del 2026-07-24 ("NO hay defaults, el bot muestra todo o pregunta") queda reemplazada: si la familia tiene un default curado se muestra ese y se ofrece el resto en la misma frase. Nunca un default silencioso. Primer default firmado: impresiones → obra 75 gr simple faz b/n. |
| Anillado — ejes | Se distingue plástico ($2.400) vs metálico ($3.200): se muestran como opciones; las medidas (diámetro del anillo) solo si el cliente las especifica (Martin, 2026-07-24). |
| Auditoría de atributos estructurados | No se modela un esquema nuevo: se resuelve limpiando/rediseñando el catálogo vía la skill de curación, para que el bot entienda nombres que hoy cargan las personas de TG para uso interno (Martin, 2026-07-24). |
| Foto de la lista del mostrador (ex-30) | **No va a existir.** El catálogo y la lista de precios salen del sistema quote-automation, que está al día (Martin, 2026-07-23). La corroboración de datos del bot es 100% estructural (señales del barrido de la skill); el descubrimiento de faltantes queda en §3 + `bot.decisiones`. |
| **Medida mayor a A3 → metro / m²** | Toda medida **mayor a A3** se cotiza **por metro o m²**, según las opciones que declare el producto (Martin/TG, 2026-08-05). **Si el producto NO tiene la variante metro/m², es porque no se trabaja esa medida mayor** → no se inventa precio ni se cae a unidad discreta: va a mail / no cotiza. Es la regla de negocio detrás de las unidades continuas (backlog B-28, acoplado a B-21 cantidad unit-aware y CM-5 totales decimales). Coherente con "Póster académico A0/A1 → m²". |
