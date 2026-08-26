// Helpers compartidos por los scripts quirúrgicos del .xlsx. Sin dependencias.
//
// El patrón de todos los scripts: leer el ZIP a mano, mutar SOLO el contenido de las
// entradas tocadas, reempaquetar entrada por entrada. Las hojas no tocadas conservan su
// XML byte-idéntico (se recomprimen, pero el contenido no cambia). Ver los headers de
// renombrar-rinde.mjs por las trampas (filas vacías, offsets del local header, estilos).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const XLSX = path.resolve(import.meta.dirname, "../../Catalogo-TG-v2.xlsx");

/** LibreOffice deja este archivo mientras el .xlsx está abierto. Escribir con el archivo
 *  abierto = el próximo guardado del usuario pisa el cambio. */
export function chequearLock() {
  const lock = path.join(path.dirname(XLSX), `.~lock.${path.basename(XLSX)}#`);
  if (fs.existsSync(lock)) {
    console.error(`ABORTADO: el archivo está abierto en LibreOffice (existe ${path.basename(lock)}).`);
    console.error("Cerralo y volvé a correr el script.");
    process.exit(1);
  }
}

/** Lee el ZIP entero. Devuelve las entradas en orden, con el contenido ya inflado. */
export function abrir() {
  const buf = fs.readFileSync(XLSX);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  const nEnt = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let e = 0; e < nEnt; e++) {
    const metodo = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const xl = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    const nombre = buf.toString("utf8", off + 46, off + 46 + nl);
    off += 46 + nl + xl + cl;
    // OJO: nameLen/extraLen del local header difieren de los del directorio central.
    const lnl = buf.readUInt16LE(lo + 26);
    const lxl = buf.readUInt16LE(lo + 28);
    const ini = lo + 30 + lnl + lxl;
    const d = buf.subarray(ini, ini + csize);
    entradas.push({ nombre, contenido: metodo === 0 ? d : zlib.inflateRawSync(d) });
  }
  const get = (n) => {
    const e = entradas.find((x) => x.nombre === n);
    if (!e) throw new Error(`no existe la entrada ${n}`);
    return e;
  };
  return { entradas, get };
}

export const dec = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Las cadenas de sharedStrings, en orden. Un <si> puede tener varios <t>. */
export function cadenasDe(ssXml) {
  const out = [];
  for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = "";
    for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
    out.push(t);
  }
  return out;
}

/**
 * Devuelve una función texto→id sobre sharedStrings, que reusa las cadenas existentes y
 * acumula las nuevas. `aplicar()` reescribe la entrada con las nuevas al final y los
 * contadores actualizados.
 */
export function indiceCadenas(ssEntry) {
  const xml = ssEntry.contenido.toString("utf8");
  const cadenas = cadenasDe(xml);
  const indice = new Map(cadenas.map((t, i) => [t, i]).reverse()); // primera aparición gana
  const extra = [];
  return {
    cadenas,
    idDe(t) {
      if (indice.has(t)) return indice.get(t);
      const id = cadenas.length + extra.length;
      extra.push(t);
      indice.set(t, id);
      return id;
    },
    nuevas: () => extra.length,
    aplicar() {
      if (!extra.length) return;
      const total = cadenas.length + extra.length;
      const siExtra = extra.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("");
      ssEntry.contenido = Buffer.from(
        xml
          .replace(/<sst([^>]*)>/, (_, a) =>
            `<sst${a
              .replace(/count="\d+"/, `count="${total}"`)
              .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)}>`)
          .replace(/<\/sst>/, `${siExtra}</sst>`),
        "utf8",
      );
    },
  };
}

/** Reempaqueta y escribe el .xlsx. Llamar SOLO con --apply y sin lock. */
export function guardar(entradas) {
  const crc32 = (() => {
    const TB = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TB[i] = c;
    }
    return (b) => {
      let c = -1;
      for (let i = 0; i < b.length; i++) c = TB[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      return (c ^ -1) >>> 0;
    };
  })();

  const locales = [], central = [];
  let cursor = 0;
  for (const en of entradas) {
    const nombre = Buffer.from(en.nombre, "utf8");
    const comp = zlib.deflateRawSync(en.contenido, { level: 9 });
    const crc = crc32(en.contenido);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(en.contenido.length, 22); lh.writeUInt16LE(nombre.length, 26);
    locales.push(lh, nombre, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(en.contenido.length, 24); ch.writeUInt16LE(nombre.length, 28);
    ch.writeUInt32LE(cursor, 42);
    central.push(ch, nombre);
    cursor += lh.length + nombre.length + comp.length;
  }
  const cuerpo = Buffer.concat(locales), dir = Buffer.concat(central);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0);
  eo.writeUInt16LE(entradas.length, 8); eo.writeUInt16LE(entradas.length, 10);
  eo.writeUInt32LE(dir.length, 12); eo.writeUInt32LE(cuerpo.length, 16);
  fs.writeFileSync(XLSX, Buffer.concat([cuerpo, dir, eo]));
}

/** La misma fórmula de encaje que visor/lib/geometria.ts, duplicada a propósito: los
 *  scripts no importan TS. Si cambia una, cambia la otra (los tests del visor la fijan). */
export function rinde(ancho, alto, { utilAncho, utilAlto, separacion: sep }) {
  if (ancho <= 0 || alto <= 0 || utilAncho <= 0 || utilAlto <= 0) return 0;
  const eje = (util, pieza) => Math.floor((util + sep) / (pieza + sep) + 1e-9);
  return Math.max(eje(utilAncho, ancho) * eje(utilAlto, alto), eje(utilAncho, alto) * eje(utilAlto, ancho), 0);
}
