// 大会期間中（最初のラウンドの判定開始1時間前〜config.until）なら終了コード0、それ以外は1
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const from = Date.parse(config.rounds[0].start) - (config.leadMinutes ?? 90) * 60000 - 3600000;
const until = Date.parse(config.until);
const now = Date.now();
process.exit(now >= from && now <= until ? 0 : 1);
