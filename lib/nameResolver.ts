import Anthropic from "@anthropic-ai/sdk";
import { getBirthdayRoster } from "./sheets";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type NameResolution =
  | { status: "exact"; name: string }
  | { status: "suggestion"; input: string; suggestion: string }
  | { status: "no_match"; input: string };

/**
 * 入力された名前を、誕生日名簿（既存メンバーの正式な名前一覧）と照合する。
 * 完全一致すればそのまま採用。一致しなければAIに「一番近い候補」を1人だけ選ばせ、
 * 確信が持てる場合のみ提案する（勝手に確定はしない。呼び出し側で本人に確認を取ること）。
 */
export async function resolveName(inputName: string): Promise<NameResolution> {
  const roster = await getBirthdayRoster();
  const names = [...new Set(roster.map((r) => r.name))];

  if (names.includes(inputName)) {
    return { status: "exact", name: inputName };
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 100,
    system:
      "以下の名簿の中から、入力された名前に最も近い人を1人だけ選んでください。" +
      "表記ゆれ・タイプミス程度の違いなら候補として選んでください。" +
      "似た名前が複数いる、または全く別人だと思われる場合は無理に選ばずnullにしてください。" +
      `名簿: ${JSON.stringify(names)}\n` +
      '出力はJSONのみ、説明文なし: {"match":"名簿内の名前"} または {"match":null}',
    messages: [{ role: "user", content: inputName }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return { status: "no_match", input: inputName };

  const match = textBlock.text.match(/\{[\s\S]*\}/);
  if (!match) return { status: "no_match", input: inputName };

  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.match && names.includes(parsed.match)) {
      return { status: "suggestion", input: inputName, suggestion: parsed.match };
    }
    return { status: "no_match", input: inputName };
  } catch {
    return { status: "no_match", input: inputName };
  }
}
