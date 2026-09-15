import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ParsedCommand =
  | { action: "set_birthday"; name: string; date: string } // dateはYYYY/MM/DD
  | { action: "set_speech_speaker"; date: string; speakers: string[] } // dateはM/D（年なし）
  | { action: "unknown" };

/**
 * 1:1チャットのメッセージを解釈する。
 * 対応：①誕生日の登録・変更 ②100秒スピーチ担当者の変更
 */
export async function parseCommand(message: string): Promise<ParsedCommand> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system:
      "あなたはPOSSEのリマインドBotのコマンド解釈役です。ユーザーのメッセージの意図を読み取り、JSONだけを出力してください。" +
      "対応する意図は2種類：" +
      '① 誕生日の登録・変更: {"action":"set_birthday","name":"名前","date":"YYYY/MM/DD"}' +
      '② 100秒スピーチ担当者の変更: {"action":"set_speech_speaker","date":"M/D","speakers":["名前1"] または ["名前1","名前2"]}（日付はローテ表に記載の月日。年は含めない）' +
      'どちらにも該当しない・読み取れない場合: {"action":"unknown"}。' +
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
    return { action: "unknown" };
  } catch {
    return { action: "unknown" };
  }
}
