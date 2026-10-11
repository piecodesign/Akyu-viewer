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

// 棋譜のラウンド：ラウンド番号（round 欄、なければ題名の「R◯」）があればそれを優先し、
// 無いときだけ作成時刻で判定する（棋譜が開始の何時間も前に作られることがあるため）
export function gameRound(game, config) {
  const nos = new Set(config.rounds.map((r) => r.no));
  const fromField = parseInt(String(game.round || "").replace(/\D/g, ""), 10);
  if (nos.has(fromField)) return fromField;
  const m = String(game.title || "").match(/R\s*(\d+)/i);
  if (m && nos.has(Number(m[1]))) return Number(m[1]);
  return roundOf(game.createdAt, config);
}

// ラウンドごとにまとめる。
// 総当たりなので同じ組み合わせは大会中に1局だけ。同じ組み合わせが複数あれば新しいほうを残す。
// ラウンドの決め方：
//   1. 棋譜に書かれたラウンド番号（round 欄、なければ題名の「R◯」）
//   2. 番号が無いときは対局者から推定：2人とも前のラウンドまでに打った局の次のラウンド
//      （各選手は毎ラウンド1局ずつ打つので、作成時刻がずれていても判別できる）
//   3. それでも決まらないときだけ作成時刻
export function groupRounds(games, config) {
  const nos = config.rounds.map((r) => r.no);
  const valid = new Set(nos);
  const byPair = new Map();
  for (const g of games) {
    const key = [g.black, g.white].sort().join("|");
    const cur = byPair.get(key);
    if (!cur || g.createdAt > cur.createdAt) byPair.set(key, g);
  }
  const list = [...byPair.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const assigned = new Map();             // game.id -> round
  const playerRounds = new Map();         // player -> Set(round)
  const mark = (g, no) => {
    assigned.set(g.id, no);
    for (const p of [g.black, g.white]) {
      if (!playerRounds.has(p)) playerRounds.set(p, new Set());
      playerRounds.get(p).add(no);
    }
  };
  const explicit = (g) => {
    const f = parseInt(String(g.round || "").replace(/\D/g, ""), 10);
    if (valid.has(f)) return f;
    const m = String(g.title || "").match(/R\s*(\d+)/i);
    return m && valid.has(Number(m[1])) ? Number(m[1]) : null;
  };
  // 1. 番号のある棋譜を先に確定
  for (const g of list) { const no = explicit(g); if (no != null) mark(g, no); }
  // 2. 番号の無い棋譜は対局者から推定（作成順に）
  for (const g of list) {
    if (assigned.has(g.id)) continue;
    const used = (p) => playerRounds.get(p) || new Set();
    const last = Math.max(0, ...used(g.black), ...used(g.white));
    let no = nos.find((n) => n > last && !used(g.black).has(n) && !used(g.white).has(n));
    if (no == null) no = roundOf(g.createdAt, config);   // 3. 最後の手段
    if (no != null && valid.has(no)) mark(g, no);
  }
  const out = {};
  for (const n of nos) out[n] = list.filter((g) => assigned.get(g.id) === n);
  return out;
}
