# R7 — Refinador final + resolución determinística (suites 5 y 6, ronda 4)

> Insumo: ronda 4 de suite-5 + suite-6 corridas por Martin en WhatsApp real (2026-07-25),
> con capturas y notas. 16 incidentes.
> **Estado: PROPUESTA. Nada construido, nada aplicado.**
> Regla que no cambia: Claude prepara, **Martin aplica**; harness verde tras cada nodo Code.

---

## 0. Lo que Martin fijó (no se discute, entra como requisito)

- **Nodo LLM final antes de TODO texto que salga al chat.** Toma los datos + el borrador,
  lo comprime, lo deja humano y entendible, y respeta las directrices de conducta.
- **Mono-variante ⇒ solo el nombre del producto.** IMPERATIVO, en todos los renders.
- **Sacar la leyenda** `(precio de lista; el precio final del trabajo te lo confirma el equipo)`.
  Reemplazo máximo permitido: "el total te lo confirmamos en el local o vía mail a
  terminalgrafica@gmail.com".
- **Variante por defecto en el catálogo curado**: forma de decirle al bot qué elegir cuando
  el cliente no especifica (⚠️ revierte parcialmente la decisión "NO hay defaults de oficio"
  del 2026-07-24 — ver §7).
- **Los Get se hacen con el nombre del producto principal** (tarjetas / impresión / lona) y el
  filtrado de variantes lo hace el sistema, no el LLM.

Única objeción que dejo escrita y sigo: un redactor fluido encima de un motor que a veces
elige mal **narra bonito el número equivocado**. Por eso el refinador de §1 se construye
*ciego a la plata* y con re-estampado + gate: no puede tocar un monto ni inventar un producto.
Con eso, el riesgo que motivaba la objeción queda cerrado y el nodo entra igual.

---

## 1. Mapa incidente → causa raíz → arreglo

| # | Incidente (suite) | Causa raíz verificada en código | Arreglo | Bloque |
|---|---|---|---|---|
| 7 | menú feo, mono-variante con medida rara, re-pregunta faz/color ya dados | `Armar Menu Opciones` L85 imprime `v.nombre` aunque el grupo tenga 1 variante; no filtra variantes por lo que el cliente ya ancló | mono-variante ⇒ nombre del producto; filtrar variantes por tokens anclados | B3 |
| 7b | no entregó la opción de 75 gr | el LLM eligió UN producto (106) sin que el cliente anclara gramaje | guard de gemelos (§2.3) | B2 |
| 11 | menú de opciones para producto de variante única | ídem 7 | ídem | B3 |
| 13 | eligió `1" 1/4` del anillado metálico sola, no mostró plástico | nada impide que el LLM invente la variante: `Get Precio` matchea por igualdad exacta y el render la acepta | guard de variante no anclada (§2.4) + telemetría de por qué se eligió | B2/B5 |
| 14 | presumió 106 gr sin mostrar opciones | gemelos 75/106 con variantes idénticas | guard de gemelos | B2 |
| 15 | no ofrece la láser 80 gr como alternativa | decisión de negocio, no bug | pregunta TG (§7) | B6 |
| 16 | todos los fallbacks dicen lo mismo | `Armar Respuesta Precio` L337-340: un solo texto para 7 estados distintos | mapa de mensaje por estado | B4 |
| 17 | visión de túnel tras derivar a mail | ventana `papelEspecialHit` de 3 mensajes suprime el número aunque el cliente pregunte por otro producto | la ventana solo aplica al MISMO producto/familia; y "obra 80 gr" pasa a resolver de verdad (18) | B2/B4 |
| 18 | `Get Precio` no encontró "OBRA 80 GR" | el cliente escribe `80gr`, el catálogo `OBRA 80 GR`; rank-2 es `LIKE %pedido%` → `obra 80gr` no es substring de `obra 80 gr` | normalizar gramajes (`(\d)\s*gr` → `\1 gr`) en ambos lados | B2 |
| 19 | `Get Precio` no encontró "150 Tarjetas Color/Negro" | el LLM compone un nombre que no existe; el matcher solo hace exacto/sinónimo/substring | LLM emite el término principal; el sistema resuelve pack/variante (§2.1) | B2 |
| 21a | 150 tarjetas → ofrece pack de 100 (peor negocio) | la cuantización "próximo tier hacia arriba" (resuelta 2026-07-24) nunca se implementó | motor de pack determinístico | B4 |
| 21b | "Dos packs de 100 te quedan en $12.000" (es c/u) + caveat duplicado | el texto lo escribe el LLM vía `p.template`; el anti-eco solo mira `/precio de lista/i` | **plantilla siempre forzada**: el LLM deja de narrar precios (§4.1) | B4 |
| S6-1 | pregunta gramaje al Vegetal (no tiene) y después lista tamaños | el LLM inventa un eje; el menú no sabe que el cliente ya dijo "a3" | guard de eje no listado (ya está en prompt) + filtro de variantes por lo anclado | B3 |
| S6-2 | "Papel Vegetal / A3" → "Eso no lo tenemos en catálogo" | variante `OFICIO / a3` ≠ `a3` (igualdad exacta) → 0 filas → Aclarador → `nada` → texto que además filtra "catálogo" | resolvedor de variante por subconjunto de tokens (§2.2) + el `nada` deja de mencionar el catálogo | B2/B4 |
| S6-4 | espiralado → precio del a3 directo, sin mostrar plástico a4/oficio | gemelos "Anillado Plastico a3" / "Anillado plástico a4/oficio" | guard de gemelos | B2 |
| S6-5a | promo "de 6 carteles ... $15.000" (es por cartel) | el display curado dice "(cartel de 1 × 0,65 m, llevando 6)" pero **el texto lo escribió el LLM**, no el sistema | plantilla siempre forzada | B4 |
| S6-5b | ofrece "te paso el detalle por mail" (no puede) y ante "Ok" se calla | acción inventada + `noop` por repetición sobre una afirmación del cliente | afirmación nunca es noop + denylist del refinador | B4 |
| S6-6 | bookcel → pregunta tamaño → deriva hablando de 106 gr | producto no anclado (gemelos) + ventana de papel especial | gemelos + §17 | B2 |
| S6-7 | menú de opciones repetido por cada pack | el pivot de packs exige que TODOS los productos tengan las MISMAS variantes; Kraft (2) rompe la familia de Color/Negro (4) | agrupar por esqueleto, no por igualdad de variantes | B3 |

---

## 2. Bloque 2 — resolución determinística (el corazón)

### 2.1 Contrato nuevo del LLM: producto principal, no SKU compuesto

`action precio` / `opciones` emiten el **término del producto** tal como lo diría el cliente o
como lo lista el catálogo (`tarjetas`, `impresiones papel obra 75 gr`, `lona mate`,
`anillado plástico`). Prohibido componer cantidad + producto (`150 Tarjetas Color/Negro`) o
producto + opción (`Impresiones a4 s/f b/n`). La cantidad va SIEMPRE en `cantidad`.

### 2.2 `Get Precio` devuelve TODAS las variantes del producto resuelto

Hoy el SQL filtra la variante (igualdad exacta) y devuelve 0 filas cuando el LLM no copia el
nombre verbatim → `sin_match` → email. Cambia a:

- resolver el **producto** (rank 1 exacto/sinónimo, rank 2 substring **normalizado con gramajes**,
  rank 3 rubro-como-producto — igual que hoy);
- devolver **todas** las variantes visibles de ese producto + `n_variantes`;
- devolver `gemelos` (productos con el mismo *esqueleto*, ver 2.3).

La elección de variante pasa a JS, con escalera:
`igualdad normalizada` → `subconjunto de tokens` (`a3` ⊂ `oficio / a3` ✅ S6-2) → `contenido`
→ `mono-variante` → **ambiguo** (menú determinístico).

### 2.3 Guard de gemelos (mata "presumió el 106")

*Esqueleto* = nombre normalizado sin dígitos ni tokens de tamaño/unidad (`a3`, `a4`, `oficio`,
`mt`, `cm`, `gr`, `unid`, `x`). Dos productos con el mismo esqueleto son gemelos.

Verificado contra el export real (88 productos):

| Gemelos detectados | ¿correcto? |
|---|---|
| `OBRA 80 GR` / `OBRA 106 GR` | sí |
| `Impresiones a4 papel obra 106 gr` / `Impresiones papel obra 75 gr` | sí (INC-7b/14) |
| `Anillado Plastico a3` / `Anillado plástico a4/oficio` | sí (S6-4) |
| `Papel Kraft 130 Gr` / `Papel Kraft 300 Gr`; `Ilustración Mate 250/300 gr` | sí |
| `100/500/1000 Tarjetas Color/Negro` | sí (van por el pivot de packs) |
| `Sobre a3` / `Sobre a4`; `Plastificado a3/A4/Oficio` | sí |
| `Sobre Ingles` × 2 (Librería $500 / Soportes $0) | sí — es el duplicado de la pregunta TG 37 |
| `Lona Mate` / `Lona Back Light` / `Lona Front Brillo` | **no son gemelos** ✅ (esqueletos distintos) |
| `Impresiones a3 tonner negro` vs impresiones obra | **no son gemelos** ✅ |
| `Ilustración Brillo 150` vs `Ilustración Mate` | **no son gemelos** ✅ |
| `Anillado Metálico a4/a3` | singleton ✅ — INC-13 lo cierra el guard de variante (2.4), no éste |

(Corrido contra `db/export-actualizado-catalogo.json` + curación 24b:
`scratchpad/gemelos.js`. Cero falsos positivos en los 88 productos.)

Regla: si hay gemelos y el cliente **no** nombró ninguno de los tokens que los distinguen
(`80` vs `106`, `a3` vs `a4/oficio`) → **no se cotiza**: menú determinístico con los gemelos.
Si los nombró, sigue el camino normal (y el guard de numerales de hoy sigue de red).
Dónde aporta de verdad: cuando el LLM emite **un** nombre exacto (rank 1) que el cliente nunca
dijo. Cuando el pedido es genérico (`plastificado`, `folletos`) el substring ya devuelve varias
filas y el camino `ambiguo` de hoy ya hace el menú.

### 2.4 Guard de variante no anclada (mata el `1" 1/4` del INC-13)

Producto con >1 variante visible + ninguna variante anclada por el cliente en la ventana →
menú de variantes. Nunca el precio de una variante elegida por el LLM.

### 2.5 Normalización de gramajes

`80gr`/`80 gr`/`80grs`/`de 80` → mismo token, en el pedido y en el nombre del catálogo.
Cierra INC-18 y destraba INC-17 (obra 80 pasa a ser un producto real, no "papel especial").

---

## 3. Bloque 3 — menús humanos

1. **Mono-variante ⇒ nombre del producto, punto.** En `Armar Menu Opciones` (3 ramas), en el
   menú rescate de `Armar Respuesta Precio`, en `Aplicar Aclarador` y en el render de precio
   (`nombreVar` pasa a mirar `n_variantes`).
2. **No re-listar lo que el cliente ya dio**: si ancló `simple faz`, el menú lista solo las
   variantes que la contienen; si queda una, no hay menú (va directo a precio o a cantidad).
3. **Pivot de packs por esqueleto** (S6-7): `100 Tarjetas Color/Negro`, `500...`, `1000...` y
   `100 Tarjetas Papel Kraft 280 gr` se agrupan por familia aunque el set de variantes difiera;
   Kraft es su propia línea, no repite el menú entero.
4. **Cupo y forma**: máximo 4 líneas por grupo; el refinador (§1) le da la voz.

---

## 4. Bloque 4 — voz, plata y salidas

### 4.1 Plantilla SIEMPRE forzada
El campo `reply`/`template` del LLM en `action precio` **se descarta**. El borrador lo arma el
sistema con el nombre del producto de la BD, y el refinador lo humaniza. Mata de un saque:
promo mal descripta (S6-5a), caveat duplicado y "dos packs ... $12.000" (21b), "el anillado
metálico de 120 páginas" (13).

### 4.2 Caveat
`(precio de lista; el precio final del trabajo te lo confirma el equipo)` sale del código.
Reemplazo: **"El total te lo confirmamos en el local o por mail."** (dirección completa solo
en la primera mención de la conversación, respetando la regla vigente).

### 4.3 Mensaje por tipo de fallback
| estado | qué dice (borrador; el refinador lo redacta) |
|---|---|
| `papel_especial` | ese papel puntual no lo tengo acá; el equipo confirma si lo tienen y a cuánto |
| `precio_cero` / `override` / `qr_multiple` | el precio de eso lo arma el equipo según el trabajo |
| `dorso` / `df_gate` | el doble faz lo confirma el equipo |
| `cap_volumen` | por ese volumen el total lo cotiza el equipo |
| `sql_error` | genérico + telemetría |
| `nada` (Aclarador) | **sin** "no lo tenemos en catálogo": "eso no lo estoy encontrando; contame un poco más o escribinos" |

### 4.4 Packs
- Cantidad que no es tier exacto → **próximo tier hacia arriba** (150 → pack de 500), diciendo
  que se trabaja por pack. Si supera el mayor tier → deriva.
- "N packs de X" → precio **c/u** explícito + total; nunca un número que se lea como el total.
- Hint de conveniencia: si el tier de arriba baja el precio por unidad, se muestra también.

### 4.5 Afirmación nunca es silencio
`ok`, `dale`, `sí`, `bueno`, `listo` respondiendo a una pregunta del bot → prohibido `noop`.

---

## 5. Bloque 1 — el refinador final

```
(rama answer)   Switch Acción ─┐
(rama precio)   Pre-Envío Precio ─┼─→ Armar Prompt Refinador → Llamar LLM Refinador
(rama menú)     Armar Menu Opciones ─┘        → Aplicar Refinador (re-estampado + gate)
                                              → Switch Destino → Enviar {Respuesta|Precio|Menu}
```

**Contrato de entrada (Code, determinístico):**
- `borrador` con cada monto reemplazado por un token opaco `«P1»`, `«P2»`… → el LLM **no ve plata**;
- `situacion` derivada del pipeline (no cuesta una llamada extra): `cotizacion` · `tabla` ·
  `menu` · `repregunta` · `deriva_mail` · `info` · `cierre` · `no_disponible` · `frustrado`;
- `hechos`: lista cerrada de lo único que puede afirmar (productos nombrados, mail, local).

**Contrato de salida:** solo texto plano, ≤ 5 líneas, mismos tokens `«Pn»` intactos.

**Gate post-LLM (Code):**
1. re-estampa los montos reales sobre los tokens;
2. rechaza si falta o sobra un token, si aparece un `$` que no salió del re-estampado, si
   aparece un producto que no estaba en `hechos`, si aparece un mail distinto, o si se pasa
   de largo;
3. rechazo ⇒ **se manda el borrador determinístico** (que por eso tiene que ser un piso
   aceptable de voz) y se loguea el rechazo como canario;
4. denylist de voz de máquina: `el catálogo`, `la lista de precios`, `el sistema`, `la variante`,
   `lo confirma el equipo`, SKUs, `te paso el detalle por mail`.

**No pasan por el refinador:** firewall, anti-injection, refusals de seguridad (son plantillas
fijas por diseño).

**Costo:** +1 llamada por saliente. Con el tope de 2 LLM/turno vigente, el refinador es el
segundo; el Aclarador (cuando dispara) lo lleva a 3 — aceptado.

---

## 6. Bloque 5 — telemetría (nota 13: "saber por qué eligió eso")

En `notas` de `bot.decisiones`, por turno: `variante_origen` (`anclada` | `mono` | `default` |
`inferida`), `gemelos_descartados`, `discriminante_faltante`, `refinador` (`ok` | `rechazado:<motivo>`).
Es la única forma de cazar el confident-wrong sin humano en Chatwoot.

---

## 7. Decisiones que necesito de Martin

1. **Caveat**: ¿la versión corta ("El total te lo confirmamos en el local o por mail", dirección
   solo la 1ª vez) o textual la tuya con la dirección siempre?
2. **Defaults**: el 2026-07-24 fijaste "NO hay defaults de oficio: el bot muestra todo o
   pregunta". Ahora pedís default + "¿buscabas algún gramaje en especial?". Confirmo que
   **reemplaza** a la anterior y la logueo así: *hay default por familia, se muestra el default
   con la puerta abierta al resto* (nunca un default silencioso).
3. **Orden de construcción**: propongo B4 (voz/plata, barato y visible) → B3 (menús) →
   B2 (resolución, el grande) → B1 (refinador arriba de todo, ya con el motor sano).
   Si preferís el refinador primero, se puede, pero tapa los síntomas que estamos midiendo.
4. **Ronda adversarial Fable** antes de construir: decime si la corro (no lanzo agentes sin
   que lo pidas).

## 8. Preguntas nuevas para TG

- **48. Papel por defecto**: cuando alguien dice "quiero imprimir esto", ¿qué papel/gramaje
  sale por defecto en el mostrador? (Insumo del default del §7.2.)
- **49. Láser vs Riso**: ¿cuándo corresponde ofrecer `OBRA 80 GR` (láser) y cuándo las
  impresiones por página de 75/106? ¿Se ofrecen como alternativa entre sí? (INC-15.)
- **50. Promo inmobiliarias**: ¿se puede llevar menos de 6 (a $19.500 el suelto) o el mínimo
  es duro? (El cotizador necesita la regla de mínimo.)
- Recordatorio: **46** (léxico de papeles) sigue abierta y es el insumo de INC-17/18.
