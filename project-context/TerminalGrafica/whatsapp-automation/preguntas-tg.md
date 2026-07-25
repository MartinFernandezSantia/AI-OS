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

31. **Unidad del doble faz** — el precio de la variante doble faz de impresiones,
    ¿es por página (carilla) o por hoja? Hasta la respuesta, el bot da la tabla sin
    total para todo pedido doble faz.
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
    ítem a $0; si es un producto vivo se revierte.

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
| Promo Inmobiliarias | Es POR CARTEL (no por pack) → `por_pack=false` + display por-cartel en `db/curacion-2026-07-24b.sql` (revisar términos "llevando 6"). La cuenta 6× es del cotizador (Martin, 2026-07-24). |
| Anillado — sinónimos de urgencia | Nada de prometer tiempo, "el anillado es anillado y ya". → sinónimos de urgencia **sacados** en `db/curacion-2026-07-24b.sql` (24 hs + ocultos 48/72/96); "anillado urgente" → sin_match (Martin, 2026-07-24). |
| Cuantización de pack | Se explica que se trabaja por pack y se cotiza el **próximo tier hacia arriba**: 150 con tiers 100/500/1000 → el de 500; si la cantidad supera el mayor tier, deriva al equipo (Martin, 2026-07-24). |
| Defaults de oficio | **NO hay.** El bot no asume: muestra todo o pregunta (Martin, 2026-07-24). Revierte la recomendación de "defaults de oficio" del consejo. |
| Anillado — ejes | Se distingue plástico ($2.400) vs metálico ($3.200): se muestran como opciones; las medidas (diámetro del anillo) solo si el cliente las especifica (Martin, 2026-07-24). |
| Auditoría de atributos estructurados | No se modela un esquema nuevo: se resuelve limpiando/rediseñando el catálogo vía la skill de curación, para que el bot entienda nombres que hoy cargan las personas de TG para uso interno (Martin, 2026-07-24). |
| Foto de la lista del mostrador (ex-30) | **No va a existir.** El catálogo y la lista de precios salen del sistema quote-automation, que está al día (Martin, 2026-07-23). La corroboración de datos del bot es 100% estructural (señales del barrido de la skill); el descubrimiento de faltantes queda en §3 + `bot.decisiones`. |
