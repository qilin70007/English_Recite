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
  const lines = type === "text" ? Math.max(4, Math.min(14, Math.ceil(words / 8)))
    : type === "sentence" || words > 8 ? Math.max(2, Math.min(8, Math.ceil(words / 8))) : 1;
  return Array.from({ length: lines }, (_, index) => `<w:p><w:pPr>${index < lines - 1 ? "<w:keepNext/>" : ""}<w:spacing w:before="80" w:after="160" w:line="500" w:lineRule="exact"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="888888"/></w:pBdr></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`).join("");
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
  const body = [paragraph(dictation ? "英语中文默写练习" : "英语未掌握内容复习清单", "Title"), paragraph(`${day}　共 ${groups.length} 本作业，${count} 条内容。`, "Metadata"), paragraph(`范围：${selectedLabels}。${dictation ? "根据中文提示默写英文。姓名：________" : "先看中文提示尝试回忆，再核对英文。"}`, "Metadata")];
  for (const assignment of groups) {
    body.push(paragraph(`${assignment.title}　${assignment.items.length} 条`, "Heading1", true));
    assignment.items.forEach((item, index) => {
      body.push(paragraph(`${index + 1}　${LABELS[item.status]}`, "EntryLabel", true));
      if (item.prompt) body.push(paragraph(`中文提示：${item.prompt}`, "Prompt", true));
      if (dictation) body.push(writingSpace(item, assignment.type));
      else {
        body.push(paragraph(`英文：${item.answer}`, "Answer", Boolean(item.note)));
        if (item.note) body.push(paragraph(`备注：${item.note}`, "Note"));
      }
    });
  }
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  // A4 portrait, readable 13pt text and native editable writing space.
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${w}" xmlns:r="${office}"><w:body>${body.join("")}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:color w:val="000000"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="324" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="320" w:after="160"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="EntryLabel"><w:name w:val="Entry label"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="60"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Prompt"><w:name w:val="Chinese prompt"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Answer"><w:name w:val="English answer"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
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
