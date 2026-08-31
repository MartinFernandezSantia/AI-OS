import { describe, expect, it } from "vitest";
import { avisos, chunks, COL_SIN_MINIMO, escalaTexto, lineaPrecio, paqueteDe, rindeEfectivo } from "../chunk";
import { escalaDe, type Datos } from "../parse";

/** Fixture chico armado a mano: dos colecciones, tres materiales, los dos modos.
 *  Mundo nuevo: los productos pliego NO cargan rinde — sale calculado de la geometría
 *  del material (área útil + separación en su primera fila). */
const datos: Datos = {
  colecciones: [
    {
      "Colección": "Stickers con forma",
      "Descripción": "Stickers cortados con forma, para interior.",
      "Material base": "Papel autoadhesivo",
    },
    // Un solo material: la base es opcional, y el chunk no la anuncia aunque esté.
    { "Colección": "Banners y lonas", "Descripción": "Lona impresa full color con ojalillos." },
  ],
  productos: [
    {
      "Colección": "Stickers con forma",
      Producto: "Stickers 3x3 cm",
      "Descripción": "Los más chicos.",
      Material: "Papel autoadhesivo",
      "Ancho (cm)": "3",
      "Alto (cm)": "3",
      // sin rinde cargado: se calcula (104 con 28x44 y sep 0,3)
    },
    {
      "Colección": "Stickers con forma",
      Producto: "Stickers en OPP 5x5 cm",
      Material: "OPP brillo",
      "Ancho (cm)": "5",
      "Alto (cm)": "5",
      // se calcula: 40
    },
    {
      "Colección": "Banners y lonas",
      Producto: "Banner de lona 1x1 m",
      Material: "Lona",
      "Ancho (cm)": "100",
      "Alto (cm)": "100",
      // sin rinde ni geometría: es modo m2
    },
  ],
  materiales: [
    {
      Material: "Papel autoadhesivo",
      Unidad: "pliego A3",
      Desde: "1",
      Hasta: "1",
      "Precio por unidad": "2500",
      "Área útil ancho (cm)": "28",
      "Área útil alto (cm)": "44",
      "Separación (cm)": "0,3",
    },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "2", Hasta: "10", "Precio por unidad": "2200" },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "11", "Precio por unidad": "2000" },
    {
      Material: "OPP brillo",
      Unidad: "pliego A3",
      Desde: "1",
      Hasta: "9",
      "Precio por unidad": "2800",
      "Área útil ancho (cm)": "28",
      "Área útil alto (cm)": "44",
      "Separación (cm)": "0,3",
    },
    { Material: "Lona", Unidad: "m2", Desde: "1", "Precio por unidad": "16000", "Mínimo facturable": "0.5" },
  ],
  parametros: [],
  hojas: [],
};

describe("escalaTexto", () => {
  it("un solo tramo (tarifa plana) muestra el monto sin rango", () => {
    expect(escalaTexto(escalaDe(datos.materiales, "Lona"), "m2")).toBe("$16.000");
  });

  it("tramo de un solo valor se escribe sin 'a', en singular", () => {
    const t = escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"), "pliego A3");
    expect(t).toContain("1 pliego A3: $2.500");
  });

  it("el tramo abierto se escribe 'N o más'", () => {
    const t = escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"), "pliego A3");
    expect(t).toContain("11 pliegos A3 o más: $2.000");
  });

  // El fallo del humo de Fase 3: con los tramos sin rótulo el modelo leyó los rangos en
  // PIEZAS (250 stickers → tramo "101 o más") en vez de en pliegos (3 → "2 a 10").
  it("CADA tramo lleva su unidad, no solo el encabezado", () => {
    const t = escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"), "pliego A3");
    // Ningún rango queda como número pelado.
    expect(t).not.toMatch(/\d+ a \d+:/);
    expect(t).toContain("2 a 10 pliegos A3");
  });

  it("sin unidad se comporta como antes (números pelados)", () => {
    expect(escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"))).toContain("2 a 10:");
  });
});

describe("lineaPrecio — la unidad se imprime tal cual viene del Excel", () => {
  // Con varios tramos el encabezado dice qué INDEXA la escala; con uno solo (tarifa plana)
  // no hay rangos que confundir y se queda con el "Precio por <unidad>" de siempre.
  it("con varios tramos el encabezado dice que la escala va por unidad de cobro", () => {
    const l = lineaPrecio("Papel autoadhesivo", escalaDe(datos.materiales, "Papel autoadhesivo"));
    expect(l).toContain("Precio según CANTIDAD DE PLIEGOS A3 (no de piezas)");
    expect(l).not.toContain("m2");
  });

  // Guard del cableado: no alcanza con que escalaTexto SEPA rotular — lineaPrecio tiene que
  // pasarle la unidad. Sin este test, quitar el argumento deja 4 tests en verde y el chunk
  // vuelve al formato que causó el fallo del humo.
  it("la línea completa lleva los tramos rotulados, no solo el encabezado", () => {
    const l = lineaPrecio("Papel autoadhesivo", escalaDe(datos.materiales, "Papel autoadhesivo"));
    expect(l).toContain("2 a 10 pliegos A3: $2.200");
    expect(l).not.toMatch(/\d+ a \d+: \$/); // ningún rango sin unidad
  });

  it("m2 lleva el mínimo facturable y no menciona pliego", () => {
    const l = lineaPrecio("Lona", escalaDe(datos.materiales, "Lona"));
    expect(l).toContain("Precio por m2"); // tarifa plana: un solo tramo
    expect(l).toContain("Mínimo facturable 0,5 m2");
    expect(l).not.toContain("pliego");
  });

  it("el tamaño del pliego sale del dato: cambiarlo a A4 cambia el texto", () => {
    const a4 = escalaDe(
      [{ Material: "Papel A4", Unidad: "pliego A4", Desde: "1", "Precio por unidad": "900" }],
      "Papel A4",
    );
    const l = lineaPrecio("Papel A4", a4);
    expect(l).toContain("Precio por pliego A4");
    expect(l).not.toContain("A3"); // ← el literal viejo lo habría forzado a A3
  });

  it("una unidad inventada por el cliente se respeta igual", () => {
    const plancha = escalaDe(
      [{ Material: "Plancha", Unidad: "plancha 30x40", Desde: "1", "Precio por unidad": "5000" }],
      "Plancha",
    );
    expect(lineaPrecio("Plancha", plancha)).toContain("Precio por plancha 30x40");
  });

  it("material sin escala no genera línea", () => {
    expect(lineaPrecio("Cartón", [])).toBe("");
  });

  describe("el plural de la unidad", () => {
    const conTramos = (unidad: string) =>
      lineaPrecio(
        "X",
        escalaDe(
          [
            { Material: "X", Unidad: unidad, Desde: "1", Hasta: "10", "Precio por unidad": "100" },
            { Material: "X", Unidad: unidad, Desde: "11", "Precio por unidad": "90" },
          ],
          "X",
        ),
      );

    it('"unidad" hace "unidades", no "unidads"', () => {
      // Salía mal y salía AL TEXTO QUE LEE EL CLIENTE: "2 a 100 unidads". Lo escribía una
      // regla que agregaba "s" a todo lo que terminara en letra.
      const l = conTramos("unidad");
      expect(l).toContain("11 unidades o más");
      expect(l).not.toContain("unidads");
    });

    it('"m2" queda intacto: no es una palabra que se pluralice', () => {
      // El borde opuesto, y el que rompió el primer arreglo: con la regla del castellano
      // ("-es" tras consonante) esto pasaba a "mes2", porque el 2 no es letra y el
      // sustantivo capturado quedaba en "m".
      const l = conTramos("m2");
      expect(l).toContain("m2");
      expect(l).not.toContain("mes2");
    });

    it("pluraliza el sustantivo y deja el calificador quieto", () => {
      expect(conTramos("pliego A3")).toContain("pliegos A3");
      expect(conTramos("paquete de 100 tarjetas")).toContain("paquetes de 100 tarjetas");
      expect(conTramos("metro lineal")).toContain("metros lineal");
    });

    it("una unidad que no está en la tabla queda sin pluralizar, no inventada", () => {
      const l = conTramos("bobinota 30x40");
      expect(l).toContain("bobinota 30x40");
      expect(l).not.toContain("bobinotas");
      expect(l).not.toContain("bobinotaes");
    });

    it("y el visor avisa de esa unidad, para que no pase inadvertida", () => {
      const conBobinota: Datos = {
        ...datos,
        materiales: [{ Material: "Z", Unidad: "bobinota 30x40", Desde: "1", "Precio por unidad": "9000" }],
        productos: [{ "Colección": "Stickers con forma", Producto: "Algo", Material: "Z" }],
      };
      expect(avisos(conBobinota).join("\n")).toContain("bobinota");
    });

    it('pero NO avisa de "m2": es un símbolo, no una palabra sin plural', () => {
      // El guard miraba la primera palabra, y en "m2" eso es "m" — que no está en la tabla
      // ni tiene por qué estarlo. Avisaba siempre, en un catálogo perfectamente sano.
      expect(avisos(datos).join("\n")).not.toContain("no tiene plural cargado");
    });
  });
});

describe("chunks — coleccion-material", () => {
  const cs = chunks(datos, "coleccion-material");

  it("parte la colección con 2 materiales en 2 chunks, y deja la de 1 en uno", () => {
    expect(cs).toHaveLength(3);
  });

  it("cada chunk lleva UNA sola línea de precio (la razón de ser de esta estrategia)", () => {
    for (const c of cs) {
      expect(c.texto.match(/^Precio (por|según) /gm) ?? []).toHaveLength(1);
    }
  });

  it("con varios materiales, el título lleva el sufijo del material", () => {
    expect(cs[0].titulo).toBe("Stickers con forma — Papel autoadhesivo");
  });

  // El ejemplo resuelve la cadena piezas → pliegos → tramo al lado del dato. Tiene que
  // elegir una cantidad DISCRIMINANTE: una donde leer la escala en piezas dé un tramo
  // distinto que leerla en pliegos. Si eligiera una donde ambas lecturas coinciden, el
  // ejemplo se ve bien y no enseña nada — que es como se coló el fallo del humo.
  it("el ejemplo de la cadena usa una cantidad donde piezas y pliegos dan tramos distintos", () => {
    // Stickers 3x3: rinde 104. 200 piezas = 2 pliegos → tramo "2 a 10" ($2.200).
    // Leídas como piezas, 200 caería en "11 o más" ($2.000): las lecturas difieren.
    expect(cs[0].texto).toContain(
      'Ej.: 200 piezas = 2 pliegos A3 (200 ÷ 104, redondeando para arriba) → tramo "2 a 10 pliegos A3", $2.200 cada pliego A3.',
    );
  });

  it("el ejemplo no aparece donde no hay conversión que hacer (m2, tarifa plana)", () => {
    expect(cs.at(-1)!.texto).not.toContain("Ej.:");
  });

  // Guard de la heurística: con rinde 4 y cortes en 2 y 51, la cantidad más chica (50) NO
  // discrimina — 13 pliegos y 50 piezas caen las dos en "2 a 50", así que como ejemplo no
  // enseña nada. La que sirve es 100 (25 pliegos → "2 a 50", pero 100 piezas → "51 o más").
  // Sin la búsqueda de una cantidad discriminante esto se pone rojo y el ejemplo es decorativo.
  it("saltea una cantidad donde ambas lecturas coinciden y elige la que discrimina", () => {
    const raro: Datos = {
      ...datos,
      productos: [
        {
          "Colección": "Stickers con forma",
          Producto: "Gigante",
          Material: "Papel autoadhesivo",
          "Ancho (cm)": "13",
          "Alto (cm)": "21", // rinde 4 en 28x44 con sep 0,3 (2x2)
        },
      ],
      materiales: [
        {
          Material: "Papel autoadhesivo",
          Unidad: "pliego A3",
          Desde: "1",
          Hasta: "1",
          "Precio por unidad": "2500",
          "Área útil ancho (cm)": "28",
          "Área útil alto (cm)": "44",
          "Separación (cm)": "0,3",
        },
        { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "2", Hasta: "50", "Precio por unidad": "2200" },
        { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "51", "Precio por unidad": "2000" },
      ],
    };
    const t = chunks(raro, "coleccion-material")[0].texto;
    expect(t).toContain('Ej.: 100 piezas = 25 pliegos A3 (100 ÷ 4, redondeando para arriba) → tramo "2 a 50 pliegos A3"');
    expect(t).not.toContain("Ej.: 50 piezas");
  });

  it("con un solo material, el título es la colección sola", () => {
    expect(cs.at(-1)!.titulo).toBe("Banners y lonas");
  });

  it("repite la descripción de la colección en cada chunk que la parte", () => {
    expect(cs[0].texto).toContain("Stickers cortados con forma");
    expect(cs[1].texto).toContain("Stickers cortados con forma");
  });

  it("el chunk m2 no menciona pliegos por ningún lado", () => {
    expect(cs.at(-1)!.texto).not.toContain("pliego");
  });

  it("el chunk pliego trae el rinde CALCULADO de cada medida, con la unidad del material", () => {
    expect(cs[0].texto).toContain("entran 104 por pliego A3");
    expect(cs[1].texto).toContain("entran 40 por pliego A3");
  });

  it("el chunk pliego habilita la medida libre y publica la geometría", () => {
    expect(cs[0].texto).toContain("Se cotiza CUALQUIER medida en cm");
    expect(cs[0].texto).toContain("Área útil del pliego A3: 28x44 cm · separación entre piezas: 0,3 cm.");
  });

  it("el encabezado de la lista dice 'Medidas de referencia', no 'disponibles'", () => {
    expect(cs[0].texto).toContain("Medidas de referencia:");
    expect(cs[0].texto).not.toContain("Medidas disponibles");
  });

  it("en modo item el encabezado dice 'Productos', no 'Medidas de referencia'", () => {
    // "Medidas de referencia" promete que se puede pedir cualquier medida. Cierto donde el
    // precio sale de la superficie; falso en un anillado, que se vende A4 y punto.
    const porUnidad: Datos = {
      ...datos,
      materiales: datos.materiales.map((m) => ({ ...m, Unidad: "unidad" })),
    };
    const t = chunks(porUnidad, "coleccion-material")[0].texto;
    expect(t).toContain("Productos:");
    expect(t).not.toContain("Medidas de referencia:");
  });

  it("el chunk m2 habilita cualquier medida con su conversión", () => {
    expect(cs.at(-1)!.texto).toContain("Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000).");
  });

  it("con separación 0, la línea dice 'sin separación entre piezas'", () => {
    const sinSep: Datos = {
      ...datos,
      materiales: datos.materiales.map((m) =>
        m["Separación (cm)"] ? { ...m, "Separación (cm)": "0" } : m,
      ),
    };
    expect(chunks(sinSep, "coleccion-material")[0].texto).toContain("sin separación entre piezas.");
  });

  it("el rinde también sigue al dato: con 'pliego A4' el texto dice A4", () => {
    const a4: Datos = {
      ...datos,
      materiales: datos.materiales.map((m) =>
        m["Unidad"] === "pliego A3" ? { ...m, Unidad: "pliego A4" } : m,
      ),
    };
    const t = chunks(a4, "coleccion-material")[0].texto;
    expect(t).toContain("entran 104 por pliego A4");
    expect(t).toContain("CANTIDAD DE PLIEGOS A4");
    expect(t).toContain("2 a 10 pliegos A4"); // los tramos rotulados también siguen al dato
    expect(t).not.toContain("A3");
  });

  it("la meta lleva lo que la Fase 2 va a escribir en metadata", () => {
    expect(cs[0].meta).toMatchObject({
      coleccion: "Stickers con forma",
      material: "Papel autoadhesivo",
      unidad: "pliego A3",
      modo: "pliego",
      productos: 1,
      geometria: { util_ancho: 28, util_alto: 44, separacion: 0.3 },
    });
  });

  it("el chunk m2 no lleva geometría en la meta", () => {
    expect(cs.at(-1)!.meta).not.toHaveProperty("geometria");
  });

  it("la meta lleva la escala completa: es lo que el auditor re-calcula", () => {
    expect(cs[0].meta.escala).toEqual([
      { desde: 1, hasta: 1, precio: 2500 },
      { desde: 2, hasta: 10, precio: 2200 },
      { desde: 11, hasta: null, precio: 2000 },
    ]);
  });

  it("el mínimo facturable viaja en la escala del material m2", () => {
    expect(cs.at(-1)!.meta.escala).toEqual([
      { desde: 1, hasta: null, precio: 16000, minimo_facturable: 0.5 },
    ]);
  });

  describe("Familia — presentaciones del mismo producto en un chunk", () => {
    // Sin agrupar, las 14 tarjetas daban 14 chunks casi idénticos: 35% del texto literal
    // compartido, y la descripción de la colección nombrando "100, 500 o 1000" DENTRO de
    // todos, así que buscar "1000 tarjetas" matcheaba con los 14 por igual.
    const conFamilia = (): Datos => ({
      ...datos,
      materiales: [
        { Material: "Pack x100", Unidad: "paquete de 100 tarjetas", Familia: "Tarjetas", Desde: "1", "Precio por unidad": "13200" },
        { Material: "Pack x500", Unidad: "paquete de 500 tarjetas", Familia: "Tarjetas", Desde: "1", "Precio por unidad": "28000" },
      ],
      colecciones: [{ "Colección": "Tarjetas", "Descripción": "Tarjetas." }],
      productos: [
        { "Colección": "Tarjetas", Producto: "100 tarjetas", Material: "Pack x100" },
        { "Colección": "Tarjetas", Producto: "500 tarjetas", Material: "Pack x500" },
      ],
    });

    it("los materiales de una familia dan UN chunk, no uno por precio", () => {
      const cs = chunks(conFamilia(), "coleccion-material");
      expect(cs).toHaveLength(1);
      expect(cs[0].titulo).toBe("Tarjetas");
    });

    it("el chunk lleva las dos presentaciones y los DOS precios", () => {
      const t = chunks(conFamilia(), "coleccion-material")[0].texto;
      expect(t).toContain("- 100 tarjetas");
      expect(t).toContain("- 500 tarjetas");
      expect(t).toContain("$13.200");
      expect(t).toContain("$28.000");
    });

    it("avisa que los precios NO se interpolan", () => {
      // 500 tarjetas no son cinco veces 100 ($28.000, no $66.000). Sin esta línea el
      // modelo tiene un precio por paquete y una cantidad, y la multiplicación es la
      // lectura natural.
      const t = chunks(conFamilia(), "coleccion-material")[0].texto;
      expect(t).toContain("no se calcula proporcionalmente");
    });

    it("la meta lleva CADA presentación con su escala: el auditor indexa por material", () => {
      // El chunk se llama "Tarjetas" pero hay dos materiales cotizables adentro. Si la
      // meta trajera solo el primero, pedir 500 no tendría con qué calcularse.
      const m = chunks(conFamilia(), "coleccion-material")[0].meta as Record<string, unknown>;
      const vs = m.variantes as { material: string; escala: { precio: number }[] }[];
      expect(vs.map((v) => v.material)).toEqual(["Pack x100", "Pack x500"]);
      expect(vs[1].escala[0].precio).toBe(28000);
    });

    it("sin familia declarada, cada material sigue teniendo su chunk", () => {
      // El default no cambia: lo que ya andaba (stickers, lonas) se arma igual que antes.
      expect(chunks(datos, "coleccion-material").length).toBe(cs.length);
      expect(cs[0].meta).not.toHaveProperty("variantes");
    });

    it("cada variante lleva cuántas piezas trae su paquete", () => {
      // Sin esto el auditor multiplicaba las dos cosas: el modelo declara el material
      // "…x1000" con cantidad 1000 (piezas) y salían 1000 paquetes.
      const m = chunks(conFamilia(), "coleccion-material")[0].meta as Record<string, unknown>;
      const vs = m.variantes as { material: string; paquete?: number }[];
      expect(vs.map((v) => v.paquete)).toEqual([100, 500]);
    });
  });

  describe("Piezas por paquete", () => {
    const mat = (Material: string, Unidad: string, extra = {}) => ({
      Material, Unidad, Desde: "1", "Precio por unidad": "1000", ...extra,
    });

    it("lo deriva del número que ya trae la unidad", () => {
      const ms = [mat("A", "paquete de 100 tarjetas"), mat("B", "paquete de 1000 tarjetas")];
      expect(paqueteDe(ms, "A")).toBe(100);
      expect(paqueteDe(ms, "B")).toBe(1000);
    });

    it("la columna cargada le gana a la unidad", () => {
      const ms = [mat("Resma especial", "resma", { "Piezas por paquete": "250" })];
      expect(paqueteDe(ms, "Resma especial")).toBe(250);
    });

    it('"pack" a secas NO es un paquete: puede ser el nombre del producto', () => {
      // El caso real, y un error que cometí: al "Pack 4 libros de medicina" le cargué
      // paquete=4 y el bot empezó a DERIVAR un producto que sí está en el catálogo — el
      // cliente pide "el pack" (cantidad 1) y 1 no es múltiplo de 4. El 4 está en el
      // nombre del producto, no en la unidad: no es un empaque de 4 piezas sueltas.
      const ms = [mat("Pack 4 libros de medicina", "pack")];
      expect(paqueteDe(ms, "Pack 4 libros de medicina")).toBeNull();
    });

    it("lo que se cobra de a uno NO tiene paquete", () => {
      // Y esto es lo que importa: si "unidad" u "hoja" devolvieran un número, el auditor
      // dividiría un precio unitario por la nada y cobraría de menos.
      const ms = [mat("Anillado", "unidad"), mat("Copia", "hoja"), mat("Lona", "m2")];
      expect(paqueteDe(ms, "Anillado")).toBeNull();
      expect(paqueteDe(ms, "Copia")).toBeNull();
      expect(paqueteDe(ms, "Lona")).toBeNull();
    });

    it("un número en una unidad que no es de conjunto no lo convierte en paquete", () => {
      // "pliego A3" y "hoja A4" tienen dígitos, pero no son paquetes de 3 ni de 4.
      const ms = [mat("Pliego", "pliego A3"), mat("Hoja", "hoja A4")];
      expect(paqueteDe(ms, "Pliego")).toBeNull();
      expect(paqueteDe(ms, "Hoja")).toBeNull();
    });

    it("una unidad de conjunto sin número da null, para que el gate lo cante", () => {
      expect(paqueteDe([mat("X", "paquete")], "X")).toBeNull();
    });

    it("un material que no existe da null en vez de romper", () => {
      expect(paqueteDe([mat("A", "paquete de 100 tarjetas")], "No existe")).toBeNull();
    });
  });

  describe("Formato — el tamaño en las palabras del cliente", () => {
    // Un recetario se vende "A5", no "14,8x21 cm". Contestar en cm no solo no ayuda: los
    // números se leen como una medida cotizable en un producto que no se cotiza por medida.
    const conFormato = (extra: Record<string, string> = {}): Datos => ({
      ...datos,
      productos: datos.productos.map((p, i) => (i === 0 ? { ...p, Formato: "A5", ...extra } : p)),
    });

    it("el formato reemplaza a los cm en la línea del producto", () => {
      const t = chunks(conFormato(), "coleccion-material")[0].texto;
      // El nombre del producto del fixture ya dice "3x3 cm", así que se compara la LÍNEA
      // del ítem, no el chunk entero.
      const linea = t.split("\n").find((l) => l.startsWith("- Stickers 3x3"))!;
      expect(linea).toContain("· A5 ·");
      expect(linea).not.toContain("· 3x3 cm");
    });

    it("sin formato, los cm siguen saliendo (lo que se cotiza por medida no cambia)", () => {
      const linea = cs[0].texto.split("\n").find((l) => l.startsWith("- Stickers 3x3"))!;
      expect(linea).toContain("· 3x3 cm ·");
    });

    it("los cm decimales se escriben en es-AR, no con punto", () => {
      // "14.8x21" es formato inglés y en un chunto en castellano se lee como otra cosa.
      const decimal: Datos = {
        ...datos,
        productos: datos.productos.map((p, i) =>
          i === 0 ? { ...p, "Ancho (cm)": "14.8", "Alto (cm)": "21" } : p,
        ),
      };
      const t = chunks(decimal, "coleccion-material")[0].texto;
      expect(t).toContain("14,8x21 cm");
      expect(t).not.toContain("14.8x21");
    });

    it("el formato no se duplica como columna extra", () => {
      const t = chunks(conFormato(), "coleccion-material")[0].texto;
      expect(t).not.toContain("Formato: A5");
    });
  });

  it("sin la columna 'Sin mínimo por trabajo', la meta dice false: el mínimo se aplica", () => {
    // El default tiene que ser el comportamiento de siempre. Si esto se invirtiera, todo
    // trabajo chico dejaría de tener piso sin que ningún caso del Excel se ponga rojo.
    expect(cs[0].meta.sin_minimo).toBe(false);
  });

  it("la colección marcada 'Sin mínimo por trabajo' viaja exenta en la meta", () => {
    const exenta: Datos = {
      ...datos,
      colecciones: datos.colecciones.map((c) => ({ ...c, "Sin mínimo por trabajo": "sí" })),
    };
    expect(chunks(exenta, "coleccion-material")[0].meta.sin_minimo).toBe(true);
  });

  it("la marca la escribe el cliente a mano: se acepta sí/si/x/1, no cualquier cosa", () => {
    const con = (v: string) =>
      chunks(
        { ...datos, colecciones: datos.colecciones.map((c) => ({ ...c, "Sin mínimo por trabajo": v })) },
        "coleccion-material",
      )[0].meta.sin_minimo;
    for (const v of ["sí", "si", "SÍ", " Si ", "x", "X", "1"]) expect(con(v)).toBe(true);
    // "no" tiene que leerse como NO exenta: un falso positivo acá le saca el piso a un
    // trabajo real y TG cobra de menos.
    for (const v of ["no", "No", "", "0", "-"]) expect(con(v)).toBe(false);
  });

  it("el material base se anuncia con la colección NOMBRADA y se marca en la meta", () => {
    // El título junta los dos ejes con un guion: sin nombrar la colección, "la colección"
    // se queda sin referente y el bot puede leerla como el título entero.
    expect(cs[0].texto).toContain('Es el material BASE de "Stickers con forma"');
    expect(cs[0].texto).not.toContain("BASE de la colección:");
    expect(cs[0].meta.es_base).toBe(true);
  });

  it("los dos ejes se declaran por separado, no solo pegados en el título", () => {
    expect(cs[0].texto).toContain("Colección: Stickers con forma. Material: Papel autoadhesivo.");
  });

  it("el chunk base lista a sus hermanos: el bot puede sugerir alternativas con un solo chunk", () => {
    expect(cs[0].texto).toContain("También hay en: OPP brillo.");
  });

  it("el material NO base nombra cuál es la base, para no cotizarse a sí mismo por default", () => {
    expect(cs[1].meta.es_base).toBe(false);
    expect(cs[1].texto).toContain('El material base de "Stickers con forma" es Papel autoadhesivo.');
  });

  it("con un solo material no hay base ni ejes separados: no hay nada que elegir", () => {
    const conBase = {
      ...datos,
      colecciones: [
        datos.colecciones[0],
        { ...datos.colecciones[1], "Material base": "Lona" },
      ],
    };
    const lona = chunks(conBase, "coleccion-material").at(-1)!;
    expect(lona.texto).not.toContain("BASE");
    expect(lona.texto).not.toContain("Colección:");
    expect(lona.meta.es_base).toBe(false);
  });
});

describe("chunks — coleccion", () => {
  const cs = chunks(datos, "coleccion");

  it("un chunk por colección", () => expect(cs).toHaveLength(2));

  it("la colección con 2 materiales arrastra 2 líneas de precio (la ambigüedad a mostrar)", () => {
    expect(cs[0].texto.match(/^Precio (por|según) /gm) ?? []).toHaveLength(2);
  });
});

describe("chunks — producto", () => {
  const cs = chunks(datos, "producto");

  it("un chunk por producto", () => expect(cs).toHaveLength(3));

  it("cada uno se lleva la escala completa de su material", () => {
    expect(cs[0].texto).toContain("11 pliegos A3 o más: $2.000");
  });

  it("nombra la colección a la que pertenece", () => {
    expect(cs[0].texto).toContain("Colección: Stickers con forma.");
  });
});

describe("el rinde: columna cargada vs geometría", () => {
  it("la columna no se filtra al chunk como columna desconocida", () => {
    const conColumna: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por unidad de cobro": "104" }],
    };
    // Si no estuviera en CONOCIDAS, saldría como "Piezas por unidad de cobro: 104".
    expect(chunks(conColumna, "coleccion-material")[0].texto).not.toContain(
      "Piezas por unidad de cobro:",
    );
  });

  it("el alias viejo 'Piezas por pliego' YA NO se acepta: sale como columna desconocida", () => {
    const conAlias: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por pliego": "104" }],
    };
    expect(chunks(conAlias, "coleccion-material")[0].texto).toContain("Piezas por pliego: 104");
  });

  it("la columna cargada GANA sobre el cálculo (dato del taller)", () => {
    const p = { ...datos.productos[0], "Piezas por unidad de cobro": "99" };
    expect(rindeEfectivo(p, { utilAncho: 28, utilAlto: 44, separacion: 0.3 })).toBe(99);
    const conColumna: Datos = { ...datos, productos: [p, datos.productos[1]] };
    expect(chunks(conColumna, "coleccion-material")[0].texto).toContain("entran 99 por pliego A3");
  });

  it("sin columna ni geometría no hay rinde (null) y el ítem no dice 'entran'", () => {
    const sinGeo: Datos = {
      ...datos,
      materiales: datos.materiales.map(
        ({ "Área útil ancho (cm)": _a, "Área útil alto (cm)": _h, "Separación (cm)": _s, ...m }) => m,
      ),
    };
    expect(rindeEfectivo(datos.productos[0], null)).toBeNull();
    expect(chunks(sinGeo, "coleccion-material")[0].texto).not.toContain("entran");
  });

  it("el rinde cargado sirve para cualquier unidad, no solo pliego", () => {
    const bobina: Datos = {
      colecciones: [{ "Colección": "Cintas", "Descripción": "Cintas impresas." }],
      productos: [
        {
          "Colección": "Cintas",
          Producto: "Cinta 2 cm",
          Material: "Bobina 50 m",
          "Piezas por unidad de cobro": "200",
        },
      ],
      materiales: [
        { Material: "Bobina 50 m", Unidad: "bobina", Desde: "1", "Precio por unidad": "45000" },
      ],
      parametros: [],
      hojas: [],
    };
    const t = chunks(bobina, "coleccion-material")[0].texto;
    expect(t).toContain("entran 200 por bobina");
    expect(t).not.toContain("pliego");
    // Una unidad "otro" no tiene fórmula de medida libre: sin línea habilitante.
    expect(t).not.toContain("Se cotiza");
  });
});

describe("avisos — lo que el chunk no puede mostrar", () => {
  it("con el fixture sano no hay avisos", () => {
    expect(avisos(datos)).toEqual([]);
  });

  // Lo encontró la Fase 4: un caso de prueba pedía "Papel autoadhesivo solo impresión",
  // un material con precio cargado pero SIN productos. No genera chunk, el bot no puede
  // verlo, y cotizó el troquelado — lo razonable con lo que tenía a la vista. El caso era
  // imposible de acertar y nada lo avisaba.
  it("material con precio pero sin productos: no genera chunk y el bot no puede cotizarlo", () => {
    const huerfano: Datos = {
      ...datos,
      materiales: [
        ...datos.materiales,
        { Material: "Papel autoadhesivo solo impresión", Unidad: "pliego A3", Desde: "1", "Precio por unidad": "1800" },
      ],
    };
    const a = avisos(huerfano);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("Papel autoadhesivo solo impresión");
    expect(a[0]).toContain("ningún producto lo usa");
  });

  // El otro error caro y silencioso del catálogo: una colección de terminaciones (laminado
  // $330, ojalillos $1.000) sin marcar como exenta. El total "se ve" bien — $4.000 — solo
  // que es 12 veces el precio real, y nada lo delata.
  describe("colección barata sin exención del mínimo", () => {
    // Un material cuyo tramo más caro queda MUY por debajo del mínimo por trabajo.
    const conLaminado = (extra: Partial<Datos> = {}): Datos => ({
      ...datos,
      parametros: [{ "Parámetro": "Mínimo por trabajo", Valor: "4000" }],
      colecciones: [...datos.colecciones, { "Colección": "Terminaciones", "Descripción": "Agregados." }],
      productos: [
        ...datos.productos,
        { "Colección": "Terminaciones", Producto: "Laminado mate", Material: "Film de laminado" },
      ],
      materiales: [
        ...datos.materiales,
        { Material: "Film de laminado", Unidad: "unidad", Desde: "1", "Precio por unidad": "330" },
      ],
      ...extra,
    });

    it("avisa que TODO pedido se va a cotizar el mínimo", () => {
      const a = avisos(conLaminado()).filter((x) => x.includes("Terminaciones"));
      expect(a).toHaveLength(1);
      expect(a[0]).toContain("$4.000");
      expect(a[0]).toContain(COL_SIN_MINIMO);
    });

    it("marcada como exenta, no avisa nada", () => {
      const d = conLaminado();
      const exenta: Datos = {
        ...d,
        colecciones: d.colecciones.map((c) =>
          c["Colección"] === "Terminaciones" ? { ...c, [COL_SIN_MINIMO]: "sí" } : c,
        ),
      };
      expect(avisos(exenta).filter((x) => x.includes("Terminaciones"))).toEqual([]);
    });

    it("una colección que SÍ supera el mínimo no se avisa aunque no esté marcada", () => {
      // Las colecciones normales del fixture (stickers a $2.500 el pliego, lona a $16.000)
      // no tienen que aparecer: el aviso sería ruido en cada carga.
      const a = avisos(conLaminado());
      expect(a.filter((x) => x.includes("Stickers con forma"))).toEqual([]);
      expect(a.filter((x) => x.includes("Banners"))).toEqual([]);
    });

    it("sin el parámetro cargado no se avisa: no hay con qué comparar", () => {
      expect(avisos(conLaminado({ parametros: [] }))).toEqual([]);
    });
  });

  it("varios materiales huérfanos: uno por cada uno", () => {
    // Nombres que NINGÚN producto del fixture usa (ojo: "OPP brillo" sí lo usa uno).
    const dos: Datos = {
      ...datos,
      materiales: [
        ...datos.materiales,
        { Material: "OPP brillo sin troquelar", Unidad: "pliego A3", Desde: "1", "Precio por unidad": "2400" },
        { Material: "Vinilo con barniz", Unidad: "m2", Desde: "1", "Precio por unidad": "20000" },
      ],
    };
    expect(avisos(dos)).toHaveLength(2);
  });

  it("producto pliego sin geometría ni rinde cargado: el bot no va a poder cotizar", () => {
    const sinGeo: Datos = {
      ...datos,
      materiales: datos.materiales.map(
        ({ "Área útil ancho (cm)": _a, "Área útil alto (cm)": _h, "Separación (cm)": _s, ...m }) => m,
      ),
    };
    const a = avisos(sinGeo);
    expect(a).toHaveLength(2); // los dos productos pliego del fixture
    expect(a[0]).toContain("Stickers 3x3 cm");
    expect(a[0]).toContain("no va a poder cotizarlo");
  });

  it("columna cargada y geometría que no coinciden: drift, gana el dato cargado", () => {
    const conDrift: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por unidad de cobro": "99" }],
    };
    // Dejar UN solo producto huerfaniza los materiales de los otros dos, y esos avisos son
    // correctos pero no son los que este test mira. Se filtra por el aviso bajo prueba.
    const a = avisos(conDrift).filter((x) => x.includes("la columna dice"));
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("la columna dice 99");
    expect(a[0]).toContain("calcula 104");
  });

  it("la MISMA medida en dos materiales y sin base marcada: hay que elegir una", () => {
    // La señal de que el material base es una decisión: el cliente puede pedir "5x5" y hay
    // dos materiales que se la dan. El fixture trae 3x3 solo en papel y 5x5 solo en OPP,
    // así que hay que agregar la 5x5 en papel para que exista la elección.
    const sinBase: Datos = {
      ...datos,
      colecciones: datos.colecciones.map(({ "Material base": _b, ...c }) => c),
      productos: [
        ...datos.productos,
        { "Colección": "Stickers con forma", Producto: "Stickers 5x5 cm", Material: "Papel autoadhesivo", "Ancho (cm)": "5", "Alto (cm)": "5" },
      ],
    };
    const a = avisos(sinBase);
    expect(a).toHaveLength(1); // solo la de 2 materiales; la de Lona no lo necesita
    expect(a[0]).toContain("Stickers con forma");
    expect(a[0]).toContain("Material base");
  });

  it("materiales que NO compiten por la misma medida: no se avisa nada", () => {
    // "Encuadernación y terminaciones" tiene 10 productos distintos (anillado, laminado,
    // ojalillos): son productos propios, no alternativas. No hay base que elegir y avisar
    // sería ruido en cada carga.
    const sinBase: Datos = {
      ...datos,
      colecciones: datos.colecciones.map(({ "Material base": _b, ...c }) => c),
    };
    // El fixture ya es así: 3x3 solo en papel, 5x5 solo en OPP.
    expect(avisos(sinBase)).toEqual([]);
  });

  it("base que apunta a un material que la colección no usa", () => {
    const mala: Datos = {
      ...datos,
      colecciones: [{ ...datos.colecciones[0], "Material base": "Vinilo UV" }, datos.colecciones[1]],
      // Con la misma medida en dos materiales, para que la base sea una decisión real.
      productos: [
        ...datos.productos,
        { "Colección": "Stickers con forma", Producto: "Stickers 5x5 cm", Material: "Papel autoadhesivo", "Ancho (cm)": "5", "Alto (cm)": "5" },
      ],
    };
    const a = avisos(mala);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("ningún producto de la colección lo usa");
  });

  it("pieza que no entra en el área útil: rinde 0, derivar a consulta", () => {
    const gigante: Datos = {
      ...datos,
      productos: [
        {
          "Colección": "Stickers con forma",
          Producto: "Sticker 30x45 cm",
          Material: "Papel autoadhesivo",
          "Ancho (cm)": "30",
          "Alto (cm)": "45",
        },
      ],
    };
    const a = avisos(gigante).filter((x) => x.includes("no entra en el área útil"));
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("no entra en el área útil");
    // Y el chunk no dice "entran 0": el ítem sale sin rinde.
    expect(chunks(gigante, "coleccion-material")[0].texto).not.toContain("entran 0");
  });

  it("los productos m2 no generan avisos aunque no tengan rinde", () => {
    // Solo el producto m2: los avisos de material huérfano son de los otros materiales,
    // que quedan sin producto por el recorte. Lo que este test fija es que el m2 en sí no
    // aporta ninguno (no tiene rinde ni geometría, y así está bien).
    const a = avisos({ ...datos, productos: [datos.productos[2]] });
    expect(a.filter((x) => !x.includes("ningún producto lo usa"))).toEqual([]);
  });
});

describe("columnas nuevas del cliente", () => {
  it("una columna desconocida aparece SOLO en el producto que la tiene", () => {
    const conGramaje: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], Gramaje: "300 g" }, datos.productos[1]],
    };
    const cs = chunks(conGramaje, "coleccion-material");
    expect(cs[0].texto).toContain("Gramaje: 300 g");
    expect(cs[1].texto).not.toContain("Gramaje");
  });
});

describe("bordes", () => {
  it("una colección declarada sin productos no genera chunk", () => {
    const cs = chunks({ ...datos, productos: [] }, "coleccion-material");
    expect(cs).toHaveLength(0);
  });

  it("un producto de una colección no declarada igual entra", () => {
    const huerfano: Datos = {
      ...datos,
      colecciones: [],
      productos: [datos.productos[2]],
    };
    const cs = chunks(huerfano, "coleccion-material");
    expect(cs).toHaveLength(1);
    expect(cs[0].titulo).toBe("Banners y lonas");
  });
});
