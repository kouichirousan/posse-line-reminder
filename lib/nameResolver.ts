import { getBirthdayRoster } from "./sheets";

export type NameResolution =
  | { status: "exact"; name: string }
  | { status: "suggestion"; input: string; suggestion: string }
  | { status: "no_match"; input: string };

/** 2つの文字列の編集距離（レーベンシュタイン距離）を計算する */
function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/** 「タイプミス程度」とみなす編集距離の許容量。名前が長いほど少し緩める */
function typoThreshold(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return Math.max(1, Math.ceil(len / 3));
}

/**
 * 入力された名前を、誕生日名簿（既存メンバーの正式な名前一覧）と照合する。
 * 完全一致すればそのまま採用。一致しなければ編集距離が最も近い候補を探し、
 * 「候補が1人に絞れる」かつ「タイプミス程度の距離に収まっている」場合のみ提案する
 * （同着で複数候補がある、または距離が離れすぎている場合は無理に選ばない）。
 * 以前はAnthropic APIで同じ判定をしていたが、コスト・外部依存を無くすため
 * 編集距離ベースのロジックに置き換えた（2026-09-16）。
 */
export async function resolveName(inputName: string): Promise<NameResolution> {
  const roster = await getBirthdayRoster();
  const names = [...new Set(roster.map((r) => r.name))];

  if (names.includes(inputName)) {
    return { status: "exact", name: inputName };
  }

  const distances = names.map((name) => ({ name, distance: levenshteinDistance(inputName, name) }));
  const minDistance = Math.min(...distances.map((d) => d.distance));
  const closest = distances.filter((d) => d.distance === minDistance);

  if (closest.length === 1 && minDistance <= typoThreshold(inputName, closest[0].name)) {
    return { status: "suggestion", input: inputName, suggestion: closest[0].name };
  }

  return { status: "no_match", input: inputName };
}
