# 每日十字

這是一個部署在 GitHub Pages 的英文單字練習網站。頁面會從 `wordlist.json` 依台北日期取得單字，不需要每天修改 `index.html`。

舊的 `wordlist.txt`、`wordbank.txt` 與 `index_old.html` 僅保留作為歷史備份，網站不會再讀取它們；後續請只更新 `wordlist.json`。

## 每日規則

- 課程起始日：2026-07-14
- 第一批：第 61–70 筆（`enough` 到 `heat`）
- 週一至週五：每天依序 10 個新單字
- 每 5 個字為一組；該組錯題必須重複完成中文辨識與拼字，直到全部答對才能進入下一組
- 第二組也必須清空錯題，兩組都完成後才算完成今天的 10 個字
- 星期六、日：優先複習本週未熟練錯題，不足 10 個時從本週單字補滿
- 學習與錯題進度：保存在目前瀏覽器的 `localStorage`
- 換裝置前可在頁尾下載進度備份，再到另一個瀏覽器匯入

## 更新單字

只需要編輯 `wordlist.json` 裡的 `words` 陣列，不需要改 HTML 或 JavaScript。新單字請接在陣列最後，並依序使用不重複的 `id`。

最小可用格式：

```json
{
  "id": "word-0235",
  "word": "example",
  "zh": "例子"
}
```

建議完整格式：

```json
{
  "id": "word-0235",
  "word": "example",
  "ipa": "/ɪɡˈzæmpəl/",
  "pos": "名詞 n.",
  "zh": "例子；範例",
  "sentence": "This is a simple example.",
  "sentenceZh": "這是一個簡單的例子。"
}
```

動詞可另外加入：

```json
"forms": {
  "ing": "adding",
  "past": "added",
  "pp": "added"
}
```

缺少音標或例句時，網站仍能使用英文與中文進行學習、選擇題及拼字；補齊資料後會自動顯示完整內容。

更新後可在專案資料夾執行：

```powershell
node scripts/validate-wordlist.mjs
```

確認格式正確後再提交到 GitHub，GitHub Pages 就會更新單字庫。

## 日期設定

日期與每天數量位於 `wordlist.json` 的 `settings`：

```json
{
  "timezone": "Asia/Taipei",
  "dailyCount": 10,
  "firstLearningDate": "2026-07-14",
  "firstWordNumber": 61,
  "weekdays": [1, 2, 3, 4, 5]
}
```

一般追加單字時不需要修改這些設定。
