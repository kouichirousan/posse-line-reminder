import Anthropic from "@anthropic-ai/sdk";
import { parseCommandByRules } from "./parseCommandRules";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type HelpTopic =
  | "set_birthday"
  | "set_speech_speaker"
  | "add_celebrant"
  | "remove_celebrant"
  | "create_reminder";

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
  | { action: "show_help"; topic: HelpTopic }
  | { action: "unknown" };

/**
 * 1:1チャットのメッセージを解釈する。
 * まず決まった言い回し（正規表現）で判定し、当てはまらなければAIにフォールバックする
 * （AIへの依存・課金を減らすためのハイブリッド方式）。
 */
export async function parseCommand(message: string): Promise<ParsedCommand> {
  const ruleResult = parseCommandByRules(message);
  if (ruleResult) return ruleResult;

  return parseCommandWithAI(message);
}

async function parseCommandWithAI(message: string): Promise<ParsedCommand> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system:
      "あなたはPOSSEのリマインドBotのコマンド解釈役です。ユーザーのメッセージの意図を読み取り、JSONだけを出力してください。" +
      "対応する意図は5種類：" +
      '① 誕生日の登録・変更: {"action":"set_birthday","name":"名前","date":"YYYY/MM/DD"}' +
      '② 100秒スピーチ担当者の変更: {"action":"set_speech_speaker","date":"M/D","speakers":["名前1"] または ["名前1","名前2"]}（日付はローテ表に記載の月日。年は含めない）' +
      '③ 誕生日を祝う人（祝福者）の追加: {"action":"add_celebrant","personName":"誕生日の人の名前","celebrantName":"祝福者として追加する人の名前"}' +
      '④ 祝福者の削除: {"action":"remove_celebrant","personName":"誕生日の人の名前","celebrantName":"祝福者から外す人の名前"}' +
      '⑤ 新しいリマインドの作成: {"action":"create_reminder","reminderType":"one_time"（1回限り）または"recurring"（毎週）,"dateOrWeekday":"one_timeならYYYY/MM/DD、recurringなら月/火/水/木/金/土/日のいずれか","message":"リマインド内容","groupLabel":"送信先グループ名（指定がなければ省略）"}' +
      'どれにも該当しない・読み取れない場合: {"action":"unknown"}。' +
      "説明文は一切つけず、JSONのみを出力してください。年が書かれていない場合は2026年として扱ってください。",
    messages: [{ role: "user", content: message }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") return { action: "unknown" };

  // AIの出力が ```json ... ``` のようなMarkdownコードフェンスで囲まれることがあるため、
  // 素のJSON部分（最初の { から最後の } まで）だけを取り出してからパースする
  const match = textBlock.text.match(/\{[\s\S]*\}/);
  if (!match) return { action: "unknown" };

  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.action === "set_birthday" && parsed.name && parsed.date) {
      return { action: "set_birthday", name: parsed.name, date: parsed.date };
    }
    if (
      parsed.action === "set_speech_speaker" &&
      parsed.date &&
      Array.isArray(parsed.speakers) &&
      parsed.speakers.length > 0
    ) {
      return { action: "set_speech_speaker", date: parsed.date, speakers: parsed.speakers };
    }
    if (parsed.action === "add_celebrant" && parsed.personName && parsed.celebrantName) {
      return {
        action: "add_celebrant",
        personName: parsed.personName,
        celebrantName: parsed.celebrantName,
      };
    }
    if (parsed.action === "remove_celebrant" && parsed.personName && parsed.celebrantName) {
      return {
        action: "remove_celebrant",
        personName: parsed.personName,
        celebrantName: parsed.celebrantName,
      };
    }
    if (
      parsed.action === "create_reminder" &&
      (parsed.reminderType === "one_time" || parsed.reminderType === "recurring") &&
      parsed.dateOrWeekday &&
      parsed.message
    ) {
      return {
        action: "create_reminder",
        reminderType: parsed.reminderType,
        dateOrWeekday: parsed.dateOrWeekday,
        message: parsed.message,
        groupLabel: parsed.groupLabel || undefined,
      };
    }
    return { action: "unknown" };
  } catch {
    return { action: "unknown" };
  }
}
