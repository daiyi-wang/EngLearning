"use strict";

const STORAGE_KEY = "engLearning.progress.v1";
const GROUP_SIZE = 5;

const app = document.getElementById("app");
const datePicker = document.getElementById("datePicker");
const todayButton = document.getElementById("todayButton");
const exportButton = document.getElementById("exportButton");
const importInput = document.getElementById("importInput");
const bankStatus = document.getElementById("bankStatus");
const toast = document.getElementById("toast");

let catalog = null;
let wordsById = new Map();
let selectedDate = "";
let selectedWords = [];
let selectedIsReview = false;
let session = null;
let locked = false;
let feedbackTimer = null;
let progress = loadProgress();

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === 1 && saved.words && saved.sessions) return saved;
  } catch (error) {
    console.warn("Progress could not be read", error);
  }
  return { version: 1, updatedAt: new Date().toISOString(), words: {}, sessions: {} };
}

function saveProgress() {
  progress.updatedAt = new Date().toISOString();
  if (session && selectedDate) progress.sessions[selectedDate] = session;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function taipeiToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDate(value) {
  return new Date(`${value}T12:00:00Z`);
}

function dateToISO(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, amount) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateToISO(date);
}

function dayOfWeek(value) {
  return parseDate(value).getUTCDay();
}

function isWeekday(value) {
  const day = dayOfWeek(value);
  return day >= 1 && day <= 5;
}

function businessDaysBefore(start, target) {
  let count = 0;
  for (let cursor = start; cursor < target; cursor = addDays(cursor, 1)) {
    if (isWeekday(cursor)) count++;
  }
  return count;
}

function dailyWordsFor(dateValue) {
  const settings = catalog.settings;
  if (dateValue < settings.firstLearningDate || !isWeekday(dateValue)) return [];
  const batch = businessDaysBefore(settings.firstLearningDate, dateValue);
  const start = settings.firstWordNumber - 1 + batch * settings.dailyCount;
  return catalog.words.slice(start, start + settings.dailyCount);
}

function weekDates(dateValue) {
  const date = parseDate(dateValue);
  const distanceToMonday = (date.getUTCDay() + 6) % 7;
  const monday = addDays(dateValue, -distanceToMonday);
  return [0, 1, 2, 3, 4].map(offset => addDays(monday, offset));
}

function wordProgress(id) {
  return progress.words[id] || { correctCount: 0, wrongCount: 0, correctAfterWrong: 0, lastResult: "" };
}

function isWeak(id) {
  const item = wordProgress(id);
  return item.wrongCount > 0 && item.correctAfterWrong < 2;
}

function seededShuffle(items, seedText) {
  let seed = [...seedText].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function weekendReviewWords(dateValue) {
  const weekly = weekDates(dateValue).flatMap(dailyWordsFor);
  const unique = [...new Map(weekly.map(word => [word.id, word])).values()];
  const weak = unique.filter(word => isWeak(word.id)).sort((a, b) => {
    const pa = wordProgress(a.id), pb = wordProgress(b.id);
    const scoreA = pa.wrongCount * 100 - pa.correctAfterWrong * 35 + (pa.lastResult === "wrong" ? 20 : 0);
    const scoreB = pb.wrongCount * 100 - pb.correctAfterWrong * 35 + (pb.lastResult === "wrong" ? 20 : 0);
    return scoreB - scoreA || String(pb.lastWrongAt || "").localeCompare(String(pa.lastWrongAt || ""));
  });

  const isSunday = dayOfWeek(dateValue) === 0;
  let priority = weak;
  if (isSunday && weak.length > catalog.settings.dailyCount) {
    priority = [...weak.slice(catalog.settings.dailyCount), ...weak.slice(0, catalog.settings.dailyCount)];
  }
  const chosen = priority.slice(0, catalog.settings.dailyCount);
  const chosenIds = new Set(chosen.map(word => word.id));
  const filler = seededShuffle(unique.filter(word => !chosenIds.has(word.id)), dateValue);
  return [...chosen, ...filler].slice(0, catalog.settings.dailyCount);
}

function newSession(words, isReview) {
  return {
    itemIds: words.map(word => word.id),
    isReview,
    phase: "learn",
    groupStart: 0,
    pointer: 0,
    score: 0,
    quizOrder: [],
    spellOrder: [],
    baseGroupIds: words.slice(0, GROUP_SIZE).map(word => word.id),
    roundIds: words.slice(0, GROUP_SIZE).map(word => word.id),
    roundKind: "base",
    groupMistakes: [],
    roundMistakes: [],
    answerShown: false,
    spellingTries: 0,
    completedAt: null
  };
}

function activeWords() {
  return session.roundIds.map(id => wordsById.get(id)).filter(Boolean);
}

function createOrRestoreSession(words, isReview) {
  const saved = progress.sessions[selectedDate];
  const ids = words.map(word => word.id);
  const compatible = saved && saved.itemIds?.length === ids.length && saved.itemIds.every((id, i) => id === ids[i]);
  session = compatible ? saved : newSession(words, isReview);
  session.isReview = isReview;
  saveProgress();
}

function recordAttempt(wordId, correct) {
  const item = wordProgress(wordId);
  if (correct) {
    item.correctCount++;
    if (item.wrongCount > 0) item.correctAfterWrong++;
    item.lastResult = "correct";
    item.lastCorrectAt = selectedDate;
  } else {
    item.wrongCount++;
    item.correctAfterWrong = 0;
    item.lastResult = "wrong";
    item.lastWrongAt = selectedDate;
    if (!session.roundMistakes.includes(wordId)) session.roundMistakes.push(wordId);
    if (!session.groupMistakes.includes(wordId)) session.groupMistakes.push(wordId);
  }
  progress.words[wordId] = item;
  saveProgress();
}

function displayDate(value) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(parseDate(value));
}

function updateHeading(words, isReview) {
  const date = parseDate(selectedDate);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date).toUpperCase();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date).toUpperCase();
  document.getElementById("stampMonth").textContent = month;
  document.getElementById("stampDay").textContent = String(date.getUTCDate()).padStart(2, "0");
  document.getElementById("stampWeekday").textContent = weekday;
  document.getElementById("dayEyebrow").textContent = isReview ? "WEEKEND REVIEW" : "TODAY'S TEN";
  document.getElementById("dayTitle").textContent = isReview ? "把本週卡住的字，再練熟一次。" : `${displayDate(selectedDate)}的 10 個字`;

  if (!words.length) {
    document.getElementById("daySummary").textContent = selectedDate < catalog.settings.firstLearningDate
      ? `課程從 ${catalog.settings.firstLearningDate} 開始。`
      : isReview ? "本週還沒有可以複習的單字。" : "單字庫尚未準備到這一天。";
    return;
  }

  if (isReview) {
    const weakCount = words.filter(word => isWeak(word.id)).length;
    document.getElementById("daySummary").textContent = weakCount
      ? `先練 ${weakCount} 個本週錯題，再用其他單字補滿。`
      : "本週沒有未熟練錯題，今天從本週單字中抽題複習。";
  } else {
    const first = Number(words[0].id.split("-")[1]);
    const last = Number(words.at(-1).id.split("-")[1]);
    document.getElementById("daySummary").textContent = `單字庫第 ${first}–${last} 筆｜每 5 個字完成一輪學習與測驗。`;
  }
}

function renderEmpty() {
  app.innerHTML = `<div class="empty-state"><div><h2>這一天沒有新單字</h2><p>${selectedDate < catalog.settings.firstLearningDate ? `第一批從 ${escapeHtml(catalog.settings.firstLearningDate)} 開始。` : selectedIsReview ? "完成平日的學習後，週末就會在這裡產生複習題。" : "請先在 wordlist.json 補上更多單字。"}</p></div></div>`;
}

function stageMeta() {
  const names = {
    learn: "先認識單字", meaning: "選出中文意思", review: "五字快速回顧",
    spelling: "看提示拼單字", groupSummary: "這一輪完成", finish: "今日完成"
  };
  const current = Math.min(selectedWords.length, session.groupStart + Math.min(session.pointer + 1, GROUP_SIZE));
  return { name: names[session.phase] || "單字練習", current };
}

function renderTop() {
  const meta = stageMeta();
  const completed = session.phase === "finish" ? selectedWords.length : session.groupStart;
  const marks = selectedWords.map((_, index) => {
    const className = index < completed ? "done" : index === Math.min(meta.current - 1, selectedWords.length - 1) ? "current" : "";
    return `<span class="track-mark ${className}"></span>`;
  }).join("");
  return `<div class="session-top">
    <div><p class="stage-label">${session.isReview ? "週末複習" : `第 ${Math.floor(session.groupStart / GROUP_SIZE) + 1} 輪`}</p><h2 class="stage-name">${meta.name}</h2></div>
    <div class="session-score"><strong>${session.score}</strong>本次答對</div>
    <div class="ten-track" aria-label="${meta.current} / ${selectedWords.length}">${marks}</div>
  </div>`;
}

function render() {
  clearTimeout(feedbackTimer);
  locked = false;
  if (!selectedWords.length) return renderEmpty();
  const renderers = { learn: renderLearn, meaning: renderMeaning, review: renderReview, spelling: renderSpelling, groupSummary: renderGroupSummary, finish: renderFinish };
  (renderers[session.phase] || renderLearn)();
}

function wordDetails(word) {
  const meta = [word.ipa, word.pos].filter(Boolean).map(escapeHtml).join(" · ");
  const forms = word.forms ? `<p class="forms">變化：${escapeHtml(word.forms.ing)} ／ ${escapeHtml(word.forms.past)} ／ ${escapeHtml(word.forms.pp)}</p>` : "";
  const example = word.sentence ? `<div class="example">${escapeHtml(word.sentence)}${word.sentenceZh ? `<small>${escapeHtml(word.sentenceZh)}</small>` : ""}</div>` : "";
  const note = !word.ipa || !word.sentence ? `<p class="data-note">這筆目前是基本資料；之後可在 wordlist.json 補上音標、詞性與例句。</p>` : "";
  return `<h3 class="word">${escapeHtml(word.word)}</h3>${meta ? `<p class="phonetic">${meta}</p>` : ""}<p class="meaning">${escapeHtml(word.zh)}</p>${forms}${example}${note}`;
}

function renderLearn() {
  const words = activeWords();
  const word = words[session.pointer];
  app.innerHTML = `${renderTop()}<div class="lesson">
    <span class="group-chip">${session.roundKind === "focus" ? "錯題再練" : `第 ${session.groupStart + session.pointer + 1} / ${selectedWords.length} 字`}</span>
    ${wordDetails(word)}
    <div class="actions">
      <button class="button secondary" id="speakWord" type="button">聽單字</button>
      ${word.sentence ? `<button class="button secondary" id="speakSentence" type="button">聽例句</button>` : ""}
      <button class="button success" id="nextLearn" type="button">${session.pointer === words.length - 1 ? "開始中文測驗" : "記住了，下一個"}</button>
    </div>
  </div>`;
  document.getElementById("speakWord").onclick = () => speak(word.word);
  if (word.sentence) document.getElementById("speakSentence").onclick = () => speak(word.sentence);
  document.getElementById("nextLearn").onclick = () => {
    if (session.pointer < words.length - 1) session.pointer++;
    else {
      session.phase = "meaning";
      session.quizOrder = shuffle(session.roundIds);
      session.pointer = 0;
      session.roundMistakes = [];
    }
    saveProgress(); render();
  };
}

function renderMeaning() {
  const id = session.quizOrder[session.pointer];
  const word = wordsById.get(id);
  const wrongMeanings = shuffle(catalog.words.filter(item => item.id !== id && item.zh !== word.zh).map(item => item.zh));
  const options = shuffle([word.zh, ...[...new Set(wrongMeanings)].slice(0, 3)]);
  app.innerHTML = `${renderTop()}<div class="lesson">
    <span class="group-chip">第 ${session.pointer + 1} / ${session.quizOrder.length} 題</span>
    <p class="question">選出最合適的中文意思</p>
    <h3 class="word">${escapeHtml(word.word)}</h3>
    ${word.ipa ? `<p class="phonetic">${escapeHtml(word.ipa)}${word.pos ? ` · ${escapeHtml(word.pos)}` : ""}</p>` : ""}
    <div class="choice-grid">${options.map(option => `<button class="choice" type="button" data-answer="${escapeAttr(option)}">${escapeHtml(option)}</button>`).join("")}</div>
    <p id="feedback" class="feedback"></p>
  </div>`;
  document.querySelectorAll(".choice").forEach(button => button.onclick = () => checkMeaning(button, word));
}

function checkMeaning(button, word) {
  if (locked) return;
  locked = true;
  const correct = button.dataset.answer === word.zh;
  document.querySelectorAll(".choice").forEach(choice => {
    if (choice.dataset.answer === word.zh) choice.classList.add("correct");
    if (choice === button && !correct) choice.classList.add("wrong");
    choice.disabled = true;
  });
  recordAttempt(word.id, correct);
  if (correct) session.score++;
  const feedback = document.getElementById("feedback");
  feedback.textContent = correct ? "答對了。" : `再記一次：${word.word} 是「${word.zh}」。`;
  feedback.className = `feedback ${correct ? "ok" : "no"}`;
  saveProgress();
  feedbackTimer = setTimeout(() => {
    session.pointer++;
    if (session.pointer >= session.quizOrder.length) { session.phase = "review"; session.pointer = 0; }
    saveProgress(); render();
  }, 950);
}

function renderReview() {
  const words = activeWords();
  app.innerHTML = `${renderTop()}<div class="lesson">
    <span class="group-chip">停一下，看完再繼續</span>
    <p class="question">快速掃過這一輪的單字，下一關要自己拼出來。</p>
    <div class="review-grid">${words.map(word => `<div class="mini-card ${session.roundMistakes.includes(word.id) ? "mistake" : ""}"><b>${escapeHtml(word.word)}</b><span>${escapeHtml(word.zh)}</span></div>`).join("")}</div>
    <div class="actions"><button id="startSpelling" class="button success" type="button">開始拼字</button></div>
  </div>`;
  document.getElementById("startSpelling").onclick = () => {
    session.phase = "spelling";
    session.spellOrder = shuffle(session.roundIds);
    session.pointer = 0;
    session.spellingTries = 0;
    session.answerShown = false;
    saveProgress(); render();
  };
}

function renderSpelling() {
  const id = session.spellOrder[session.pointer];
  const word = wordsById.get(id);
  const sentence = word.sentence ? word.sentence.replace(new RegExp(escapeRegExp(word.word), "gi"), "_____") : "請依照中文意思拼出英文單字。";
  app.innerHTML = `${renderTop()}<div class="lesson">
    <span class="group-chip">第 ${session.pointer + 1} / ${session.spellOrder.length} 題</span>
    <p class="question">${escapeHtml(word.zh)}</p>
    <div class="example">${escapeHtml(sentence)}${word.sentenceZh ? `<small>${escapeHtml(word.sentenceZh)}</small>` : ""}</div>
    ${session.answerShown ? `<p class="meaning">答案：${escapeHtml(word.word)}</p>` : ""}
    <input id="spellInput" class="spell-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the word" aria-label="輸入英文單字">
    <p id="feedback" class="feedback"></p>
    <div class="actions">
      <button id="checkSpelling" class="button success" type="button">檢查答案</button>
      <button id="firstLetter" class="button secondary" type="button">提示第一個字母</button>
      <button id="speakSpelling" class="button secondary" type="button">聽發音</button>
    </div>
  </div>`;
  const input = document.getElementById("spellInput");
  input.focus();
  input.onkeydown = event => { if (event.key === "Enter") checkSpelling(word); };
  document.getElementById("checkSpelling").onclick = () => checkSpelling(word);
  document.getElementById("firstLetter").onclick = () => {
    const feedback = document.getElementById("feedback");
    feedback.textContent = `第一個字母是 ${word.word[0].toUpperCase()}，共 ${word.word.length} 個字元。`;
    feedback.className = "feedback";
  };
  document.getElementById("speakSpelling").onclick = () => speak(word.word);
}

function checkSpelling(word) {
  if (locked) return;
  const input = document.getElementById("spellInput");
  const answer = input.value.trim().replace(/\s+/g, " ").toLowerCase();
  const correct = answer === word.word.trim().replace(/\s+/g, " ").toLowerCase();
  const feedback = document.getElementById("feedback");
  if (correct) {
    locked = true;
    recordAttempt(word.id, true);
    session.score++;
    feedback.textContent = session.answerShown ? "已經拼對了，再往下一題。" : "拼對了。";
    feedback.className = "feedback ok";
    saveProgress();
    feedbackTimer = setTimeout(() => {
      session.pointer++;
      session.spellingTries = 0;
      session.answerShown = false;
      if (session.pointer >= session.spellOrder.length) session.phase = "groupSummary";
      saveProgress(); render();
    }, 850);
    return;
  }

  recordAttempt(word.id, false);
  session.spellingTries++;
  if (session.spellingTries >= 3) {
    session.answerShown = true;
    feedback.textContent = `答案是 ${word.word}。請照著再輸入一次。`;
  } else {
    feedback.textContent = `還差一點，剩 ${3 - session.spellingTries} 次提示前嘗試。`;
  }
  feedback.className = "feedback no";
  saveProgress();
  if (session.answerShown) render(); else input.select();
}

function renderGroupSummary() {
  const remaining = session.groupMistakes.filter(id => isWeak(id));
  const isLastGroup = session.groupStart + GROUP_SIZE >= selectedWords.length;
  app.innerHTML = `${renderTop()}<div class="lesson">
    <span class="group-chip">${session.roundKind === "focus" ? "錯題加強完成" : "一輪完成"}</span>
    <h3 class="meaning">${remaining.length ? `還有 ${remaining.length} 個錯題，必須全部練對` : "這一輪的單字全部答對了"}</h3>
    ${remaining.length ? `<p class="data-note">完成下面錯題的中文辨識與拼字後，系統會再次檢查；錯題歸零才能進入下一組。</p>` : ""}
    ${remaining.length ? `<div class="review-grid">${remaining.map(id => { const word = wordsById.get(id); return `<div class="mini-card mistake"><b>${escapeHtml(word.word)}</b><span>${escapeHtml(word.zh)}</span></div>`; }).join("")}</div>` : ""}
    <div class="actions">
      ${remaining.length
        ? `<button id="focusMistakes" class="button warning" type="button">再練錯題，直到全對</button>`
        : `<button id="continueGroup" class="button success" type="button">${isLastGroup ? "完成今天的 10 個字" : "進入下一組 5 個字"}</button>`}
    </div>
  </div>`;
  if (remaining.length) {
    document.getElementById("focusMistakes").onclick = () => startFocusRound(remaining);
    return;
  }
  document.getElementById("continueGroup").onclick = () => {
    if (isLastGroup) {
      session.phase = "finish";
      session.completedAt = new Date().toISOString();
    } else {
      session.groupStart += GROUP_SIZE;
      session.baseGroupIds = session.itemIds.slice(session.groupStart, session.groupStart + GROUP_SIZE);
      session.roundIds = [...session.baseGroupIds];
      session.roundKind = "base";
      session.groupMistakes = [];
      session.roundMistakes = [];
      session.phase = "learn";
      session.pointer = 0;
    }
    saveProgress(); render();
  };
}

function startFocusRound(ids) {
  session.roundIds = [...ids];
  session.roundKind = "focus";
  session.roundMistakes = [];
  session.phase = "learn";
  session.pointer = 0;
  session.quizOrder = [];
  session.spellOrder = [];
  session.spellingTries = 0;
  session.answerShown = false;
  saveProgress(); render();
}

function renderFinish() {
  const weak = session.itemIds.filter(id => isWeak(id));
  app.innerHTML = `${renderTop()}<div class="finish">
    <div class="finish-mark">✓</div>
    <h2>${session.isReview ? "本週複習完成" : "今天的十個字完成"}</h2>
    <p>${weak.length ? `目前還有 ${weak.length} 個字會保留在錯題清單，週末複習會優先抽到。` : "今天沒有留下未熟練錯題。明天會依單字庫順序接著往下。"}</p>
    <div class="actions">
      <button id="restartSession" class="button secondary" type="button">重新練習這一天</button>
      <button id="nextDate" class="button success" type="button">查看下一天</button>
    </div>
  </div>`;
  document.getElementById("restartSession").onclick = () => {
    if (!confirm("要清除這一天的關卡進度並重新開始嗎？錯題統計會保留。")) return;
    session = newSession(selectedWords, selectedIsReview);
    saveProgress(); render();
  };
  document.getElementById("nextDate").onclick = () => {
    datePicker.value = addDays(selectedDate, 1);
    selectDate(datePicker.value);
  };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return showToast("這個瀏覽器不支援語音播放。");
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = .82;
  speechSynthesis.speak(utterance);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectDate(value) {
  selectedDate = value;
  selectedIsReview = !isWeekday(value) && value >= catalog.settings.firstLearningDate;
  selectedWords = selectedIsReview ? weekendReviewWords(value) : dailyWordsFor(value);
  updateHeading(selectedWords, selectedIsReview);
  if (selectedWords.length) createOrRestoreSession(selectedWords, selectedIsReview);
  else session = null;
  render();
}

function exportProgress() {
  saveProgress();
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `eng-learning-progress-${taipeiToday()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("學習進度已備份。");
}

async function importProgress(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (imported?.version !== 1 || !imported.words || !imported.sessions) throw new Error("格式不符");
    if (!confirm("匯入後會取代這個瀏覽器目前的學習進度，是否繼續？")) return;
    progress = imported;
    saveProgress();
    selectDate(selectedDate);
    showToast("學習進度已匯入。");
  } catch (error) {
    showToast("無法匯入：這不是有效的學習進度檔。");
  } finally {
    importInput.value = "";
  }
}

async function init() {
  try {
    const response = await fetch(`wordlist.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.words) || !catalog.settings) throw new Error("Invalid wordlist schema");
    wordsById = new Map(catalog.words.map(word => [word.id, word]));
    bankStatus.textContent = `單字庫共 ${catalog.words.length} 筆｜下批從第 ${catalog.settings.firstWordNumber} 筆開始`;
    selectedDate = taipeiToday();
    datePicker.value = selectedDate;
    selectDate(selectedDate);
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="empty-state"><div><h2>讀不到單字庫</h2><p>請確認 wordlist.json 與 index.html 放在同一個資料夾，並使用網站網址開啟。</p></div></div>`;
    bankStatus.textContent = "單字庫讀取失敗";
  }
}

datePicker.addEventListener("change", () => { if (datePicker.value) selectDate(datePicker.value); });
todayButton.addEventListener("click", () => { datePicker.value = taipeiToday(); selectDate(datePicker.value); });
exportButton.addEventListener("click", exportProgress);
importInput.addEventListener("change", () => { if (importInput.files[0]) importProgress(importInput.files[0]); });

let lastToday = taipeiToday();
setInterval(() => {
  const now = taipeiToday();
  if (now !== lastToday) {
    const wasViewingToday = selectedDate === lastToday;
    lastToday = now;
    if (wasViewingToday) { datePicker.value = now; selectDate(now); showToast("新的一天，單字已更新。"); }
  }
}, 30000);

init();
