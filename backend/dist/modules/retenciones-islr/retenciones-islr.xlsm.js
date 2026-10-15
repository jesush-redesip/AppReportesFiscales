import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Macro de la planilla vieja de retenciones ISLR (`MakeXML`, "Rutina XML Seniat"), tal cual
 * venía en el .xlsm que generaba el sistema anterior. Lee la carpeta de salida en C2, el RIF
 * del agente en H1, el período en H2, la cantidad de filas en I1 y los datos desde la fila 5
 * (columnas B..H); usa I y J como auxiliares y escribe el subtotal en L5.
 */
const VBA_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'RETENCIONES_ISLR_XML.vbaProject.bin');
// Nombres de código que trae el proyecto VBA: el libro y la hoja deben llamarse igual.
const CODENAME_LIBRO = 'ThisWorkbook';
const CODENAME_HOJA = 'Hoja5';
/** Botón de formulario "Convertir a XML" que ejecuta MakeXML (columnas K..L, filas 1..2). */
const VML_BOTON = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
 <o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
 <v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe">
  <v:stroke joinstyle="miter"/>
  <v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/>
  <o:lock v:ext="edit" shapetype="t"/>
 </v:shapetype>
 <v:shape id="_x0000_s1025" type="#_x0000_t201" style="position:absolute;margin-left:0;margin-top:0;width:110pt;height:28pt;z-index:1;mso-wrap-style:tight" o:button="t" fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:insetmode="auto">
  <v:fill color2="buttonFace [67]" o:detectmouseclick="t"/>
  <o:lock v:ext="edit" rotation="t"/>
  <v:textbox style="mso-direction-alt:auto" o:singleclick="f">
   <div style="text-align:center"><font face="Arial" size="200" color="#000000">Convertir a XML</font></div>
  </v:textbox>
  <x:ClientData ObjectType="Button">
   <x:Anchor>10, 4, 0, 4, 11, 60, 1, 18</x:Anchor>
   <x:PrintObject>False</x:PrintObject>
   <x:AutoFill>False</x:AutoFill>
   <x:FmlaMacro>[0]!MakeXML</x:FmlaMacro>
   <x:TextHAlign>Center</x:TextHAlign>
   <x:TextVAlign>Center</x:TextVAlign>
  </x:ClientData>
 </v:shape>
</xml>`;
const REL_VBA = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';
const REL_VML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';
/** Agrega un atributo a la primera etiqueta `<tag ...>` o la crea con `crear()` si no existe. */
function conAtributo(xml, tag, atributo, crear) {
    const re = new RegExp(`<${tag}(\\s[^>]*?)?(/?)>`);
    const m = re.exec(xml);
    if (!m)
        return crear(xml);
    const attrs = (m[1] ?? '').replace(new RegExp(`\\s${atributo.split('=')[0]}="[^"]*"`), '');
    return xml.slice(0, m.index) + `<${tag}${attrs} ${atributo}${m[2]}>` + xml.slice(m.index + m[0].length);
}
function agregarRelacion(rels, tipo, destino) {
    const base = rels ??
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let n = 1;
    while (base.includes(`Id="rId${n}"`))
        n++;
    const id = `rId${n}`;
    return {
        id,
        xml: base.replace('</Relationships>', () => `<Relationship Id="${id}" Type="${tipo}" Target="${destino}"/></Relationships>`),
    };
}
/**
 * Convierte el .xlsx de una sola hoja que genera ExcelJS en un .xlsm con la macro de la
 * planilla vieja y su botón "Convertir a XML".
 */
export async function convertirEnXlsm(xlsx) {
    const zip = await JSZip.loadAsync(xlsx);
    const leer = async (p) => (await zip.file(p)?.async('string')) ?? null;
    // Tipos de contenido: libro con macros + proyecto VBA + dibujo VML.
    let tipos = (await leer('[Content_Types].xml'));
    tipos = tipos.replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml');
    tipos = tipos.replace('</Types>', '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
    if (!tipos.includes('Extension="vml"')) {
        tipos = tipos.replace('<Default ', '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default ');
    }
    zip.file('[Content_Types].xml', tipos);
    // Proyecto VBA colgando del libro.
    zip.file('xl/vbaProject.bin', await fs.readFile(VBA_PATH));
    zip.file('xl/_rels/workbook.xml.rels', agregarRelacion(await leer('xl/_rels/workbook.xml.rels'), REL_VBA, 'vbaProject.bin').xml);
    let libro = (await leer('xl/workbook.xml'));
    libro = conAtributo(libro, 'workbookPr', `codeName="${CODENAME_LIBRO}"`, (x) => x.replace(/<bookViews|<sheets/, (m) => `<workbookPr codeName="${CODENAME_LIBRO}"/>${m}`));
    zip.file('xl/workbook.xml', libro);
    // Hoja: nombre de código, y el botón como dibujo VML (legacyDrawing).
    const hojaPath = 'xl/worksheets/sheet1.xml';
    const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
    zip.file('xl/drawings/vmlDrawingBotonXml.vml', VML_BOTON);
    const rel = agregarRelacion(await leer(relsPath), REL_VML, '../drawings/vmlDrawingBotonXml.vml');
    zip.file(relsPath, rel.xml);
    let hoja = (await leer(hojaPath));
    hoja = conAtributo(hoja, 'sheetPr', `codeName="${CODENAME_HOJA}"`, (x) => x.replace(/(<worksheet[^>]*>)/, (m) => `${m}<sheetPr codeName="${CODENAME_HOJA}"/>`));
    if (!hoja.includes('xmlns:r=')) {
        hoja = hoja.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    }
    // legacyDrawing va después de pageMargins/pageSetup/headerFooter/drawing y antes de tableParts/extLst.
    const legacy = `<legacyDrawing r:id="${rel.id}"/>`;
    const antes = /<(legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]|<\/worksheet>/.exec(hoja);
    hoja = hoja.slice(0, antes.index) + legacy + hoja.slice(antes.index);
    zip.file(hojaPath, hoja);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
//# sourceMappingURL=retenciones-islr.xlsm.js.map