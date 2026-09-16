import { parseCommandByRules } from "./parseCommandRules";

export type HelpTopic = "set_birthday" | "set_speech_speaker" | "add_celebrant" | "remove_celebrant";

export type ParsedCommand =
  | { action: "set_birthday"; name: string; date: string } // dateはYYYY/MM/DD
  | { action: "set_speech_speaker"; date: string; speakers: string[] } // dateはM/D（年なし）
  | { action: "add_celebrant"; personName: string; celebrantName: string }
  | { action: "remove_celebrant"; personName: string; celebrantName: string }
  | {
      action: "create_reminder";
      reminderType: "one_time" | "recurring";
      dateOrWeekday: string; // one_time: YYYY/MM/DD、recurring: 月/火/水/木/金/土/日
      message: string;
      groupLabel?: string;
    }
  | { action: "show_menu" }
  | { action: "show_celebrant_menu" }
  | { action: "start_reminder_wizard" }
  | { action: "show_help"; topic: HelpTopic }
  | { action: "unknown" };

/**
 * 1:1チャットのメッセージを解釈する。
 * 決まった言い回し（正規表現）で判定し、当てはまらなければ「読み取れない」扱いにする。
 * 以前はAIへのフォールバックがあったが、Anthropic APIへの依存を完全に無くすため撤去した
 * （2026-09-16）。自由な言い回しに対応したい場合は、メニューのボタン案内から正しい言い回しを
 * 送ってもらう運用でカバーする。
 */
export async function parseCommand(message: string): Promise<ParsedCommand> {
  return parseCommandByRules(message) ?? { action: "unknown" };
}
