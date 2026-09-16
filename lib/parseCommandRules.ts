import type { ParsedCommand } from "./parseCommand";

/**
 * 決まった言い回し（テンプレート）にマッチするかを正規表現で判定する。
 * ここでマッチすればAnthropic APIを呼ばずに済む（コスト削減・依存排除）。
 * どれにもマッチしなければ null を返し、呼び出し側でAIにフォールバックする。
 *
 * 対応テンプレート（利用者に案内する正式な言い回し）：
 * ・誕生日登録　　：「〇〇さんの誕生日は2026/5/1です」
 * ・100スピ変更　：「5/25の100スピ担当を〇〇に変更してください」（複数人は「〇〇と△△に」）
 * ・祝福者追加　　：「〇〇さんの祝福者に△△を追加してください」
 * ・祝福者削除　　：「〇〇さんの祝福者から△△を削除してください」
 * ・単発リマインド：「2026/12/25に『忘年会があります』とリマインドしてください」
 *                  （グループ指定：「熱中タームグループで2026/12/25に『〜』とリマインドしてください」）
 * ・定期リマインド：「毎週金曜日に『週報を出してください』とリマインドしてください」
 */
export function parseCommandByRules(text: string): ParsedCommand | null {
  const t = text.trim();

  // 誕生日登録：〇〇さんの誕生日は2026/5/1です
  let m = t.match(/^(.+?)さんの誕生日は(\d{4})\/(\d{1,2})\/(\d{1,2})です[。.！!]?$/);
  if (m) {
    const [, name, y, mo, d] = m;
    return { action: "set_birthday", name, date: `${y}/${mo}/${d}` };
  }

  // 100スピ担当変更：5/25の100スピ担当を〇〇に変更してください（複数人は「と」区切り）
  m = t.match(/^(\d{1,2})\/(\d{1,2})の100スピ担当を(.+?)に変更してください[。.！!]?$/);
  if (m) {
    const [, mo, d, namesPart] = m;
    const speakers = namesPart
      .split(/と|、/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { action: "set_speech_speaker", date: `${mo}/${d}`, speakers };
  }

  // 祝福者追加：〇〇さんの祝福者に△△を追加してください
  m = t.match(/^(.+?)さんの祝福者に(.+?)を追加してください[。.！!]?$/);
  if (m) {
    const [, personName, celebrantName] = m;
    return { action: "add_celebrant", personName, celebrantName };
  }

  // 祝福者削除：〇〇さんの祝福者から△△を削除してください
  m = t.match(/^(.+?)さんの祝福者から(.+?)を削除してください[。.！!]?$/);
  if (m) {
    const [, personName, celebrantName] = m;
    return { action: "remove_celebrant", personName, celebrantName };
  }

  // 単発リマインド：（熱中タームグループで）2026/12/25に「忘年会があります」とリマインドしてください
  m = t.match(
    /^(?:(.+?)グループで)?(\d{4})\/(\d{1,2})\/(\d{1,2})に[「『](.+?)[」』]とリマインドしてください[。.！!]?$/
  );
  if (m) {
    const [, groupLabel, y, mo, d] = m;
    const message = m[5];
    return {
      action: "create_reminder",
      reminderType: "one_time",
      dateOrWeekday: `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}`,
      message,
      groupLabel: groupLabel ?? undefined,
    };
  }

  // 定期リマインド：（熱中タームグループで）毎週金曜日に「週報を出してください」とリマインドしてください
  m = t.match(
    /^(?:(.+?)グループで)?毎週(月|火|水|木|金|土|日)曜日?に[「『](.+?)[」』]とリマインドしてください[。.！!]?$/
  );
  if (m) {
    const [, groupLabel, weekday, message] = m;
    return {
      action: "create_reminder",
      reminderType: "recurring",
      dateOrWeekday: weekday,
      message,
      groupLabel: groupLabel ?? undefined,
    };
  }

  return null;
}
