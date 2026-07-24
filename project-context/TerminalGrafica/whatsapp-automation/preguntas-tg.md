# Preguntas pendientes a TG — consolidado

> Única fuente de verdad de lo que falta preguntarle a TG (sesiones hasta 2026-07-23,
> incluye pasada 1 de curación: 35-41).
> Ideal: UNA sola conversación. **Criterio transversal:** cada respuesta aterriza como
> DATO (producto nuevo, sinónimo/display en el overlay, o línea de Info del negocio),
> nunca como regla nueva de prompt.
> Al final: lo ya resuelto (para no re-preguntar) y los temas comerciales a avisar.

## 1. Gates del catálogo limpio (bloquean partes del go-live del dedupe)

1. **¿El papel obra de 75 gr (el de las impresiones comunes) es A4? ¿Hay otros
   tamaños?** — Gate del renombre de la zona sucia. Decisión ya tomada si la
   respuesta es sí: el display pasa a "Impresiones a4 papel obra 75 gr" y los
   sinónimos de a4 se duplican en 75 y 106 (nunca quedan en uno solo).
2. **¿El precio de módulos/apuntes es SOLO para estudiantes de medicina o para
   cualquiera?** — La poda de 'apuntes' lo asume solo-medicina; si es para todos,
   se re-ensancha.
3. **El 106 gr b/n simple faz tiene precio de lista $120 pero su tabla por cantidad
   arranca en $180. ¿Cuál vale?** — Dato sucio latente (hoy invisible: siempre gana
   la tabla; si algún día desactivan la regla, saldría $120).
4. **Papel obra 106: ¿cuándo va por laser ($800/hoja) y cuándo por Riso/inkjet
   (tabla desde $180)?** — Son dos productos con precios muy distintos y el cliente
   dice "papel obra de 106" para ambos.

## 2. Directas de catálogo

5. **Medios de pago y seña** — ¿Mercado Pago? ¿tarjetas? ¿piden seña? ¿transferencia?
   (consulta frecuente; hoy escala siempre). → Info del negocio.
6. **¿Los imanes se venden al público?** — El producto Iman existe con tabla de
   cantidad. Si no es de público, se oculta en el overlay.
7. **Sobres ingleses duplicados en el sistema** (Librería $500 vs Soportes
   Especiales $0 + tabla) — ¿unidad vs pack? ¿cuál va? → se oculta o renombra uno.
8. **Papel vegetal x10 (a4 y a3/oficio): precio real** — En la BD están en $0 sin
   reglas; hoy derivan a email siempre.
9. **¿Hacen pasacalles?** — Si sí, entra como sinónimo de lona; si no, sigue
   derivando a humano.
10. **Medidas de ploteo/impresión grande: ¿hasta qué medida? ¿A1/A0?** — Hoy las
    medidas grandes solo se contestan para lo que va por m² (lona/cartelería);
    láminas A1 de arquitectura escalan siempre.
11. **Ítems de taller (encuadernado, refilado, troquelados, ojales, etc.):
    ¿cuándo aplican y cada cuánto son?** — ¿O se deja simple como está hoy?
    (pedido de Martin 2026-07-21).
36. **"A5 ILUST. MATE 250 GR": la única variante cargada es "A4" ($600)** — y el
    A4 de "Ilustración Mate 250 gr" sale $900. ¿La variante es en realidad A5
    (mal cargada) o el producto duplica al otro? (pasada 1 de curación).
37. **"Anillado Plastico a3": única variante "A4" ($3.200)** — ¿es A3 o A4?
    (el a4/oficio sale $2.400). (pasada 1 de curación).
38. **"Vinilo, Lona Brillo/Mate Uv" ($22.000, unidad "metro")** — ¿el precio es
    por metro LINEAL o por m²? (el resto del UV va por m²). ¿Y se imprime en
    lona además de vinilo? (ninguna variante lo refleja). (pasada 1).
39. **Folios a4/oficio ($500 c/u): ¿son fundas plásticas o papel/hojas sueltas?**
    — define sinónimos y casos de uso; en la pasada 1 se podaron "hojas a4" /
    "papeles a4" / "papel bond", que cotizaban folios a quien pedía hojas.

## 3. Servicios implícitos (TG los calcula internamente y no están cargados)

Para cada uno: ¿lo hacen?, ¿cómo se calcula? (¿= valor impresión?, ¿por hoja?,
¿por unidad?) y ¿desde cuántas unidades?

12. **Fotocopias b/n y color** — LA consulta #1 del mostrador; hoy escala siempre.
13. **Escaneo / digitalización** — ¿por hoja? ¿lo mandan por mail al cliente?
14. **Diapositivas / PowerPoint 2-4-6 por hoja** — clásico universitario;
    ¿se cobra por hoja o por slide?
15. **Plegado / doblado** (trípticos) — pega con Folletos.
16. **Empastado / tapa dura** (tesis de posgrado) y **termoencuadernado**.
17. **Tapas para anillados** — ¿EXISTEN como producto? (cierra con datos una
    confabulación vista en tests).
18. **Foto carnet 4x4.**
19. **Impresión de fotos 10x15 / 13x18.**
20. **Póster académico de congreso A0/A1** — ¿se hace en lona/PVC por m²?
21. **Impresión en el acto desde mail/WhatsApp/celular** — ¿cómo es el proceso de
    mostrador? (pega con USB, ya resuelto).
22. **Guillotinado / corte chico suelto** — el producto Corte x Millar es por mil;
    ¿y cortar 20 hojas?

## 4. Segunda línea (solo si la reunión da)

23. Sellos. 24. Diseño/ajuste de archivo. 25. Talonarios AFIP.
26. Transparencias/filminas. 27. Papel fotográfico. 28. Mapas/planos plegados.
29. "Vinilo brillo" está en dos rubros (Solvente y UV): ¿hay un default de mostrador
    cuando el cliente no especifica?
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
33. **Adicionales de papel (bookcel / "Adicional 106")** — tres sub-preguntas que
    deciden si las tablas y totales de impresiones son confiables:
    (a) ¿el "Adicional papel obra 106" se selecciona ALGUNA VEZ sobre trabajos del
    propio producto 106? ¿en qué caso concreto?;
    (b) ¿existe alguna clase de trabajo donde un adicional de papel se aplique
    SIEMPRE (es decir: el papel se cobra aparte de la impresión)? — **si la
    respuesta es sí, hay rollback pre-decidido**: se apagan número/tabla/total de
    las variantes afectadas hasta re-modelar (plan v7 §Ronda 3);
    (c) el "a4/oficio" del nombre del adicional, ¿es el tamaño del papel del
    adicional, o un upgrade de tamaño que se le vende a trabajos a4?
34. **Formato de los apuntes/módulos de medicina** — la única variante cargada es
    "Impresion a4 s/f color" ($45/página). ¿Es el único formato en que se imprimen
    (siempre a4, siempre simple faz, siempre color)? ¿O existen b/n, doble faz u
    otros tamaños con precio especial de medicina que faltan cargar? Hasta la
    respuesta, el bot presupone ese único formato sin decírselo al cliente.
35. **Promo Inmobiliarias: ¿$15.000 es por cartel llevando 6, o por el pack
    completo de 6?** — el cartel suelto 1×0,65 sale $19.500; un pack de 6 a
    $15.000 no cierra (87% off). Define `por_pack`: hoy está en true (el bot
    muestra $15.000 como precio del conjunto); si es por cartel, sub-cotiza 6×
    y hay que pasarlo a false. (pasada 1 de curación).
36. **Precio especial de medicina: ¿para quién es?** — en la ronda 2 el bot le
    ofreció el $45/página de medicina a un cliente que pidió "apuntes" genéricos.
    Desde r6 el bot solo lo menciona si el cliente dice "medicina" (guard de
    nicho) y ante la duda pregunta "¿es material de medicina?". ¿Es la conducta
    correcta, o el precio especial se le da a cualquiera que imprima apuntes?
    (Complementa la 34, que pregunta por el formato.)
37. **"Sobre Inglés" figura dos veces** — uno a $500 (rubro Librería) y otro a
    $0 (rubro Soportes Especiales). ¿El de $0 es un duplicado viejo para borrar?
    Mientras tanto lo ocultamos (curación 1c) para que no salga un menú con un
    ítem a $0; si es un producto vivo se revierte.
38. **Anillado a4/oficio — sinónimos de urgencia** — el producto conserva los
    sinónimos "anillado express" / "anillo plastico ya" / "anillado urgente".
    Sirven para que el bot RESUELVA cuando el cliente los usa, pero rozan la idea
    de plazo (que lo define el equipo, decisión I14). ¿Los dejamos (solo
    resuelven, no prometen tiempo) o los sacamos? Recomendación: dejarlos.

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
| Foto de la lista del mostrador (ex-30) | **No va a existir.** El catálogo y la lista de precios salen del sistema quote-automation, que está al día (Martin, 2026-07-23). La corroboración de datos del bot es 100% estructural (señales del barrido de la skill); el descubrimiento de faltantes queda en §3 + `bot.decisiones`. |
