import { readFile } from "node:fs/promises";

const path = new URL("../wordlist.json", import.meta.url);
const data = JSON.parse(await readFile(path, "utf8"));
const errors = [];
const warnings = [];

if (data.schemaVersion !== 1) errors.push("schemaVersion 必須是 1");
if (!data.settings || !Array.isArray(data.words)) errors.push("缺少 settings 或 words");

const ids = new Set();
const wordOccurrences = new Map();

for (const [index, item] of (data.words || []).entries()) {
  const label = `第 ${index + 1} 筆`;
  if (!item.id) errors.push(`${label}缺少 id`);
  if (!item.word?.trim()) errors.push(`${label}缺少 word`);
  if (!item.zh?.trim()) errors.push(`${label}缺少 zh`);
  if (ids.has(item.id)) errors.push(`${label}的 id 重複：${item.id}`);
  ids.add(item.id);

  const expectedId = `word-${String(index + 1).padStart(4, "0")}`;
  if (item.id && item.id !== expectedId) warnings.push(`${label}的 id 是 ${item.id}，建議使用 ${expectedId}`);

  const normalized = item.word?.trim().toLowerCase();
  if (normalized) wordOccurrences.set(normalized, [...(wordOccurrences.get(normalized) || []), index + 1]);
}

for (const [word, positions] of wordOccurrences) {
  if (positions.length > 1) warnings.push(`「${word}」出現於第 ${positions.join("、")} 筆（可能是刻意複習）`);
}

const detailed = (data.words || []).filter(item => item.ipa && item.pos && item.sentence && item.sentenceZh).length;
console.log(`單字總數：${data.words?.length || 0}`);
console.log(`完整資料：${detailed}`);
console.log(`基本資料：${(data.words?.length || 0) - detailed}`);

if (warnings.length) {
  console.log("\n提醒：");
  warnings.forEach(message => console.log(`- ${message}`));
}

if (errors.length) {
  console.error("\n格式錯誤：");
  errors.forEach(message => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log("\nwordlist.json 格式正確。");
}
