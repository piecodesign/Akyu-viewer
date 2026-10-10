// RenjuPortal の棋譜一覧を取得し、対象の棋譜を data/games.json に保存する
// 使い方: node scripts/update-games.mjs            （ネットから取得）
//         node scripts/update-games.mjs --file x.json（保存済みのAPI応答で試す）
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { toGame, isTarget } from "../lib.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("config.json", root), "utf8"));
const outFile = new URL("data/games.json", root);
const API = "https://renjuportal.com/api/score";

const from = Date.parse(config.rounds[0].start) - (config.leadMinutes ?? 90) * 60000;
const until = Date.parse(config.until);

async function getPage(page) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${API}?page=${page}&limit=100`, {
        headers: { "User-Agent": "meijin-a-viewer (GitHub Actions)", Accept: "application/json" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      console.warn(`page ${page} 取得失敗 (${i + 1}回目): ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error("RenjuPortal から一覧を取得できませんでした");
}

async function collectDocs() {
  const i = process.argv.indexOf("--file");
  if (i > 0) return JSON.parse(await readFile(process.argv[i + 1], "utf8")).docs;
  const docs = [];
  for (let page = 1; page <= 5; page++) {
    const j = await getPage(page);
    docs.push(...j.docs);
    const oldest = Date.parse(j.docs.at(-1)?.createdAt || 0);
    if (!j.docs.length || oldest < from || page >= j.pages) break;
  }
  return docs;
}

// 大会期間外は何もしない（手動実行と --file は除く）
const now = Date.now();
const manual = process.argv.includes("--file") || process.env.GITHUB_EVENT_NAME !== "schedule";
if (!manual && (now < from - 3600000 || now > until)) {
  console.log("大会期間外のため取得をスキップしました");
  process.exit(0);
}

let prev = { games: [] };
try { prev = JSON.parse(await readFile(outFile, "utf8")); } catch {}

const found = new Map(prev.games.map((g) => [g.id, g]));
for (const d of await collectDocs()) {
  if (d.status && d.status !== "publish") continue;
  const g = toGame(d);
  if (isTarget(g, d.author?.userId, config)) found.set(g.id, g);
}
const games = [...found.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const before = JSON.stringify(prev.games);
const after = JSON.stringify(games);
if (before === after) {
  console.log(`変化なし（${games.length}局）`);
} else {
  await mkdir(new URL("data/", root), { recursive: true });
  await writeFile(outFile, JSON.stringify({ changedAt: new Date().toISOString(), games }, null, 1) + "\n");
  console.log(`更新しました（${games.length}局）`);
}
