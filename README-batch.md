# gemini-image

Gemini 逕ｻ蜒冗函謌撰ｼ亥酔譛溘・Batch・峨・ home 繝ｪ繝昴ず繝医Μ蜷梧｢ｱ迚医・
豁｣譛ｬ縺ｯ [`ysk373/scripts`](https://github.com/ysk373/scripts)・・generate-image-batch.js` / `lib/gemini-http.js`・峨→蜷梧悄縺励※縺上□縺輔＞縲・
## 繧ｳ繝槭Φ繝・
```bash
# 騾ｱ谺｡ Automation 蜷代￠繝ｩ繝・ヱ繝ｼ・域耳螂ｨ・・bash scripts/robot-image-batch.sh collect-pending
bash scripts/robot-image-batch.sh submit tech/robot/.state/manifests/robot-papers-DATE.json

# 逶ｴ謗･
node scripts/gemini-image/generate-image-batch.js submit <manifest.json>
node scripts/gemini-image/generate-image-batch.js collect <state.json> --wait
```

隧ｳ邏ｰ: [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
