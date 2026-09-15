import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ParsedCommand =
  | { action: "set_birthday"; name: string; date: string } // dateはYYYY/MM/DD
  | { action: "unknown" };

/**
 * 1:1チャットのメッセージを解釈する。現状は誕生日の登録・変更のみ対応（MVP第一弾）。
 * 今後、100秒スピーチの担当変更などにも拡張する。
 */
export async function parseCommand(message: string): Promise<ParsedCommand> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system:
      "あなたはPOSSEのリマインドBotのコマンド解釈役です。ユーザーのメッセージから「誕生日の登録・変更」の意図を読み取り、JSONだけを出力してください。" +
      '該当する場合: {"action":"set_birthday","name":"名前","date":"YYYY/MM/DD"}。' +
      '該当しない・読み取れない場合: {"action":"unknown"}。' +
      "説明文は一切つけず、JSONのみを出力してください。年が書かれていない場合は2026年として扱ってください。",
    messages: [{ role: "user", content: message }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") return { action: "unknown" };

  try {
    const parsed = JSON.parse(textBlock.text);
    if (parsed.action === "set_birthday" && parsed.name && parsed.date) {
      return { action: "set_birthday", name: parsed.name, date: parsed.date };
    }
    return { action: "unknown" };
  } catch {
    return { action: "unknown" };
  }
}
