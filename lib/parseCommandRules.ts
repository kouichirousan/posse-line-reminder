import type { HelpTopic, ParsedCommand } from "./parseCommand";

// メニューのボタンをタップすると、この固定文言がユーザーメッセージとして送信される
// （LINEのQuick Reply=MessageActionの仕様）。
// 構成：①メニュー→「100スピ／誕生日／祝福者／リマインド作成」の4択
//      ②100スピ・誕生日はそのまま言い方を案内、祝福者は「追加／削除」のサブメニューへ
//      ③リマインド作成だけは案内で終わらず、質問形式のウィザードを開始する（start_reminder_wizard）
const MENU_TRIGGER_TEXTS = ["メニュー", "ヘルプ", "使い方", "使い方メニュー"];
const CELEBRANT_MENU_TRIGGER_TEXT = "祝福者";
const REMINDER_WIZARD_TRIGGER_TEXT = "リマインド作成";
const HELP_TOPIC_TEXTS: Record<string, HelpTopic> = {
  "100スピ": "set_speech_speaker",
  誕生日: "set_birthday",
  祝福者追加: "add_celebrant",
  祝福者削除: "remove_celebrant",
};

/**
 * 決まった言い回し（テンプレート）にマッチするかを正規表現で判定する。
 * どれにもマッチしなければ null を返し、呼び出し側は「読み取れない」扱いにする
 * （Anthropic APIへのフォールバックは2026-09-16に撤去済み。外部AI依存ゼロで完結する）。
 *
 * 対応テンプレート（利用者に案内する正式な言い回し）：
 * ・誕生日登録　　：「〇〇さんの誕生日は2026/5/1です」
 * ・100スピ変更　：「5/25の100スピ担当を〇〇に変更してください」（複数人は「〇〇と△△に」）
 * ・祝福者追加　　：「〇〇さんの祝福者に△△を追加してください」
 * ・祝福者削除　　：「〇〇さんの祝福者から△△を削除してください」
 * ・単発リマインド：「2026/12/25に『忘年会があります』とリマインドしてください」
 *                  （グループ指定：「熱中タームグループで2026/12/25に『〜』とリマインドしてください」）
 * ・定期リマインド：「毎週金曜日に『週報を出してください』とリマインドしてください」
 *
 * 「メニュー」「ヘルプ」等を送るとQuick Replyのボタン式メニューを表示する（show_menu）。
 * トップメニューは「100スピ／誕生日／祝福者／リマインド作成」の4択。
 * 「100スピ」「誕生日」は該当する言い回しをそのまま案内（show_help）。
 * 「祝福者」はさらに「祝福者追加／祝福者削除」のサブメニューを挟む（show_celebrant_menu）。
 * 「リマインド作成」だけは案内で終わらせず、1項目ずつ質問して埋めていくウィザードを開始する
 * （start_reminder_wizard。上記の単発／定期リマインドのテンプレート文言は、
 * ウィザードを使わず直接1文で送りたい人向けに引き続き有効）。
 */
export function parseCommandByRules(text: string): ParsedCommand | null {
  const t = text.trim();

  if (MENU_TRIGGER_TEXTS.includes(t)) {
    return { action: "show_menu" };
  }
  if (t === CELEBRANT_MENU_TRIGGER_TEXT) {
    return { action: "show_celebrant_menu" };
  }
  if (t === REMINDER_WIZARD_TRIGGER_TEXT) {
    return { action: "start_reminder_wizard" };
  }
  if (t in HELP_TOPIC_TEXTS) {
    return { action: "show_help", topic: HELP_TOPIC_TEXTS[t] };
  }

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
