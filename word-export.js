import { createZip } from "./archive.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LABELS = { unknown: "不认识", fuzzy: "模糊", new: "未标记" };
const xml = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function selectUnmastered(assignments, scope = "all", statuses = ["unknown", "fuzzy"]) {
  const allowed = new Set(statuses.filter((status) => Object.hasOwn(LABELS, status)));
  const selected = new Set(Array.isArray(scope) ? scope : [scope]);
  return assignments.filter((assignment) => scope === "all" || selected.has(assignment.id))
    .map((assignment) => ({ ...assignment, items: assignment.items.filter((item) => allowed.has(item.status)) }))
    .filter((assignment) => assignment.items.length);
}

export function missingDictationPrompts(groups) {
  return groups.flatMap((a) => a.items.flatMap((item, index) => String(item.prompt || "").trim()
    ? [] : [`${a.title}：第 ${index + 1} 条`]));
}

function writingSpace(item, type) {
  const words = String(item.answer || "").trim().split(/\s+/).length;
  const lines = type === "text" ? Math.max(4, Math.min(120, Math.ceil(words / 8)))
    : type === "sentence" || words > 8 ? Math.max(2, Math.min(8, Math.ceil(words / 8))) : 1;
  return Array.from({ length: lines }, (_, index) => `<w:p><w:pPr>${index === 0 && lines > 1 ? "<w:keepNext/>" : ""}<w:tabs><w:tab w:val="right" w:leader="underscore" w:pos="10466"/></w:tabs><w:spacing w:before="0" w:after="0" w:line="540" w:lineRule="atLeast"/></w:pPr><w:r><w:rPr><w:color w:val="888888"/></w:rPr><w:tab/></w:r></w:p>`).join("");
}

function dictationEntry(item, index, type) {
  const prompt = String(item.prompt).trim();
  const words = String(item.answer || "").trim().split(/\s+/).length;
  // One roomy writing line for ordinary words/phrases; long sentences and texts
  // expand naturally instead of shrinking the font or truncating the prompt.
  if (type !== "text" && words <= 6 && [...prompt].length <= 18 && !/[\r\n]/.test(prompt)) {
    return `<w:p><w:pPr><w:pStyle w:val="DictationEntry"/><w:tabs><w:tab w:val="right" w:leader="underscore" w:pos="10466"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">${index + 1}. ${xml(prompt)}　　</w:t></w:r><w:r><w:tab/></w:r></w:p>`;
  }
  return paragraph(`${index + 1}. ${prompt}`, "DictationPrompt", true) + writingSpace(item, type);
}

function paragraph(text, style = "Normal", keepNext = false) {
  const runs = String(text).split(/\r\n?|\n/).map((line, index) => `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${keepNext ? "<w:keepNext/>" : ""}</w:pPr>${runs}</w:p>`;
}

export async function createUnmasteredDocx(assignments, { scope = "all", statuses = ["unknown", "fuzzy"], date = new Date(), layout = "bilingual" } = {}) {
  const groups = selectUnmastered(assignments, scope, statuses);
  const count = groups.reduce((sum, assignment) => sum + assignment.items.length, 0);
  if (!count) throw new Error("所选范围没有这些状态的内容，请调整选择。");
  const dictation = layout === "dictation";
  const missing = dictation ? missingDictationPrompts(groups) : [];
  if (missing.length) throw new Error(`有 ${missing.length} 条缺少中文提示，请先在整体编辑中补充：${missing.slice(0, 3).join("；")}`);
  const selectedLabels = Object.keys(LABELS).filter((key) => statuses.includes(key)).map((key) => LABELS[key]).join("、");
  const day = new Intl.DateTimeFormat("zh-CN").format(date);
  const body = [paragraph(dictation ? "英语中文默写练习" : "英语未掌握内容复习清单", "Title")];
  if (dictation) body.push(paragraph(`${day}　姓名：________　共 ${count} 条`, "Metadata"));
  else body.push(paragraph(`${day}　共 ${groups.length} 本作业，${count} 条内容。`, "Metadata"), paragraph(`范围：${selectedLabels}。先看中文提示尝试回忆，再核对英文。`, "Metadata"));
  for (const assignment of groups) {
    body.push(paragraph(`${assignment.title}　${assignment.items.length} 条`, "Heading1", true));
    assignment.items.forEach((item, index) => {
      if (dictation) {
        body.push(dictationEntry(item, index, assignment.type));
        return;
      }
      body.push(paragraph(`${index + 1}　${LABELS[item.status]}`, "EntryLabel", true));
      if (item.prompt) body.push(paragraph(`中文提示：${item.prompt}`, "Prompt", true));
      body.push(paragraph(`英文：${item.answer}`, "Answer", Boolean(item.note)));
      if (item.note) body.push(paragraph(`备注：${item.note}`, "Note"));
    });
  }
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const margin = dictation ? 720 : 1080;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${w}" xmlns:r="${office}"><w:body>${body.join("")}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:color w:val="000000"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="324" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="${dictation ? 100 : 240}"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="${dictation ? 160 : 320}" w:after="${dictation ? 80 : 160}"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/>${dictation ? '<w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="atLeast"/></w:pPr>' : ''}<w:rPr><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="EntryLabel"><w:name w:val="Entry label"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="60"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Prompt"><w:name w:val="Chinese prompt"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Answer"><w:name w:val="English answer"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="DictationEntry"><w:name w:val="Dictation entry"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="280" w:line="520" w:lineRule="atLeast"/></w:pPr><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="DictationPrompt"><w:name w:val="Dictation prompt"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="0" w:line="400" w:lineRule="atLeast"/><w:keepNext/></w:pPr><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  </w:styles>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="document" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": document,
    "word/styles.xml": styles,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="styles" Type="${office}/styles" Target="styles.xml"/><Relationship Id="footer" Type="${office}/footer" Target="footer1.xml"/></Relationships>`,
    "word/footer1.xml": `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="${w}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r></w:p></w:ftr>`,
  };
  return createZip(Object.entries(files).map(([name, content]) => ({ name, blob: new Blob([content]) })), DOCX_MIME);
}
