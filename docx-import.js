import { openZip } from "./archive.js";
import { parseImportedContent } from "./core.js";

// WordprocessingML structure: https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document
const WORD_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const INVALID_DOCX = "DOCX 文件不完整、已加密或格式不支持，请在 Word / WPS 中另存为 .docx 后重试。";
const isWord = (node, name) => WORD_NAMESPACES.has(node.namespaceURI) && node.localName === name;
const wordAttribute = (node, name) => [...WORD_NAMESPACES].map((ns) => node.getAttributeNS(ns, name)).find(Boolean) || "";

function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(INVALID_DOCX);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(INVALID_DOCX);
  return document;
}

async function readXml(entry) {
  const bytes = new Uint8Array(await (await entry.read()).arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0 ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c ? "utf-16be" : "utf-8";
  return parseXml(new TextDecoder(encoding, { fatal: true }).decode(bytes));
}

function textOf(node) {
  if (isWord(node, "del") || isWord(node, "moveFrom") || isWord(node, "instrText")) return "";
  if (isWord(node, "t")) return node.textContent;
  if (isWord(node, "tab")) return "\t";
  if (isWord(node, "br") || isWord(node, "cr")) return "\n";
  if (isWord(node, "noBreakHyphen")) return "-";
  return [...node.children].map(textOf).join("");
}

function blocksOf(node) {
  const blocks = [];
  for (const child of node.children) {
    if (isWord(child, "del") || isWord(child, "moveFrom")) continue;
    if (isWord(child, "p") || isWord(child, "tbl")) blocks.push(child);
    else blocks.push(...blocksOf(child));
  }
  return blocks;
}

function tableText(table, labeled) {
  const rows = [...table.children].filter((node) => isWord(node, "tr"))
    .map((row) => [...row.children].filter((node) => isWord(node, "tc"))
      .map((cell) => blocksOf(cell).map((block) => isWord(block, "p") ? textOf(block) : tableText(block, labeled)).join("\n").trim()))
    .filter((row) => row.some(Boolean));
  if (!rows.length) return "";
  const headers = rows[0].map((cell) => cell.replace(/[\s【】():：]/g, "").toLowerCase());
  const prompt = headers.findIndex((cell) => /^(中文|中文提示|提示|释义|中文释义|chinese|prompt|front)$/.test(cell));
  const answer = headers.findIndex((cell) => /^(英文|英语|英文内容|英文答案|单词|短语|句子|背诵内容|english|answer|back)$/.test(cell));
  const hasHeader = answer >= 0;
  return (hasHeader ? rows.slice(1) : rows).map((row) => {
    if (hasHeader) {
      const chinese = prompt >= 0 ? row[prompt] || "" : "";
      const english = row[answer] || "";
      if (!chinese && !english) return "";
      if (labeled) return `${chinese ? `【中文】${chinese}\n` : ""}【英文】${english}`;
      // Cells are entries, so manual line breaks inside a cell must not split a word pair.
      return chinese ? `${chinese.replace(/\s+/g, " ")} | ${english.replace(/\s+/g, " ")}` : english.replace(/\s+/g, " ");
    }
    if (row.length > 1 && /^\s*\d+[.、．]?\s*$/.test(row[0])) row = row.slice(1);
    const line = row.map((cell) => cell.replace(/\s+/g, " ")).join(" | ");
    if (labeled && !/【(?:中文|英文)】/.test(line)) {
      return parseImportedContent(line).map((item) => `${item.prompt ? `【中文】${item.prompt}\n` : ""}【英文】${item.answer}`).join("\n");
    }
    return line;
  }).filter(Boolean).join("\n");
}

export async function readDocxText(file) {
  if (file.size > 32 * 1024 * 1024) throw new Error("DOCX 文件超过 32 MB，请按作业拆分，或移除较大的图片后上传。");
  const zip = await openZip(file, { allowDeflate: true, maxEntrySize: 8 * 1024 * 1024, invalidMessage: INVALID_DOCX });
  let path = "word/document.xml";
  if (zip.has("_rels/.rels")) {
    const relationships = await readXml(zip.get("_rels/.rels"));
    const main = [...relationships.documentElement.children].find((node) => /\/officeDocument$/.test(node.getAttribute("Type") || ""));
    if (main) {
      if (main.getAttribute("TargetMode") === "External") throw new Error(INVALID_DOCX);
      const target = new URL(main.getAttribute("Target"), "https://docx.local/");
      if (target.origin !== "https://docx.local") throw new Error(INVALID_DOCX);
      path = decodeURIComponent(target.pathname.slice(1));
    }
  }
  const entry = zip.get(path);
  if (!entry) throw new Error(INVALID_DOCX);
  const document = await readXml(entry);
  if (!isWord(document.documentElement, "document")) throw new Error(INVALID_DOCX);
  const body = [...document.documentElement.children].find((node) => isWord(node, "body"));
  if (!body) throw new Error(INVALID_DOCX);
  const blocks = blocksOf(body);
  const labeled = blocks.some((block) => /【(?:中文|英文)】/.test(textOf(block)));
  const text = blocks.map((block) => {
    if (isWord(block, "tbl")) return tableText(block, labeled);
    const properties = [...block.children].find((node) => isWord(node, "pPr"));
    const style = properties && [...properties.children].find((node) => isWord(node, "pStyle"));
    if (labeled && style && /^(Title|Subtitle|Heading[1-9]|标题[1-9]?)$/i.test(wordAttribute(style, "val"))) return "";
    // Word's automatic numbering is metadata; extract only the actual paragraph text.
    return textOf(block).trim();
  }).filter(Boolean).join("\n\n");
  if (!text.trim()) throw new Error("DOCX 中没有可读取的文字；如果内容是图片，请改用“拍照识别”。");
  return text;
}
