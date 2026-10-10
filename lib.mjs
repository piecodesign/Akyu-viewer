// ブラウザ（index.html）と GitHub Actions（scripts/update-games.mjs）の両方で使う共通処理

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// RenjuPortal の内部ID（24桁の16進）を、ページURLに使われる短いIDに変換する
export function shortId(hex) {
  let n = BigInt("0x" + hex), s = "";
  while (n > 0n) { s = B62[Number(n % 62n)] + s; n /= 62n; }
  return s;
}

// 「久家　彰夫」「久家 彰夫」などの空白ゆれを吸収
export const norm = (name) => String(name || "").replace(/[\s　]/g, "");

// APIの1件を、保存用の小さな形にする
export function toGame(doc) {
  const g = doc.boardState?.game || {};
  const a = g.playerA || {}, b = g.playerB || {};
  // 色の記入がない場合は playerA=黒 とみなす。記入された色は開始時の色なので、
  // 珠型の交替（swap）が奇数回あれば黒白を入れ替える
  let aIsWhite = a.color === "white" || (b.color === "black" && a.color !== "black");
  const swaps = (doc.boardState?.moves || []).filter((m) => m && m.swap === true).length;
  if (swaps % 2 === 1) aIsWhite = !aIsWhite;
  const black = aIsWhite ? b : a, white = aIsWhite ? a : b;
  return {
    id: doc._id,
    sid: shortId(doc._id),
    createdAt: doc.createdAt,
    title: (g.title || "").trim(),
    round: (g.round || "").trim(),
    black: norm(black.name),
    white: norm(white.name),
    result: g.result || "-",
    endNumber: g.endNumber || "-",
  };
}

// 結果を「黒勝ち／白勝ち／引き分け／対局中」に
export function outcome(game) {
  const r = game.result;
  if (!r || r === "-") return { key: "live", label: "対局中" };
  if (r === "draw") return { key: "draw", label: "引き分け" };
  const last = String(game.endNumber || "").split("-")[0]; // 最後に打った色
  const other = last === "black" ? "white" : last === "white" ? "black" : "";
  let win = "";
  // 投了・五連・時間切れ＝最後に打った側の勝ち、禁手＝相手の勝ち
  if (r === "forbidden") win = other;
  else if (r === "resign" || r === "five" || r === "timeout") win = last;
  if (win === "black") return { key: "black", label: "黒勝ち" };
  if (win === "white") return { key: "white", label: "白勝ち" };
  return { key: "done", label: "終局" };
}

// 作成時刻からラウンド番号を判定（開始 leadMinutes 分前〜次のラウンドの開始 leadMinutes 分前）
export function roundOf(createdAt, config) {
  const t = Date.parse(createdAt);
  const lead = (config.leadMinutes ?? 90) * 60000;
  const rs = config.rounds;
  for (let i = rs.length - 1; i >= 0; i--) {
    const from = Date.parse(rs[i].start) - lead;
    const to = i + 1 < rs.length ? Date.parse(rs[i + 1].start) - lead : Date.parse(config.until);
    if (t >= from && t < to) return rs[i].no;
  }
  return null;
}

// 対象の棋譜か（作成者・期間・対局者がA級10名同士）
export function isTarget(game, authorId, config) {
  if (authorId !== config.author) return false;
  if (roundOf(game.createdAt, config) == null) return false;
  const set = new Set(config.players.map(norm));
  return set.has(game.black) && set.has(game.white);
}

// ラウンドごとにまとめる。同じ対戦が重複したら新しいほうを残す
export function groupRounds(games, config) {
  const map = new Map(config.rounds.map((r) => [r.no, new Map()]));
  for (const g of games) {
    const no = roundOf(g.createdAt, config);
    if (no == null) continue;
    const key = [g.black, g.white].sort().join("|");
    const cur = map.get(no).get(key);
    if (!cur || g.createdAt > cur.createdAt) map.get(no).set(key, g);
  }
  const out = {};
  for (const [no, m] of map) out[no] = [...m.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}
