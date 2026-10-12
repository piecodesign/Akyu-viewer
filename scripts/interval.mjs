// 次の取得までの秒数を出力する
// ラウンド開始の10分前〜開始4時間後（対局中ずっと）は30秒、それ以外は180秒
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const now = Date.now();
const hot = config.rounds.some((r) => {
  const s = Date.parse(r.start);
  return now >= s - 10 * 60000 && now <= s + 240 * 60000;
});
console.log(hot ? 30 : 180);
