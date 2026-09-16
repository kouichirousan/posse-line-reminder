import { messagingApi, validateSignature } from "@line/bot-sdk";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";

export const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken,
});

export function verifyLineSignature(body: string, signature: string | null): boolean {
  if (!signature) return false;
  return validateSignature(body, channelSecret, signature);
}

export async function pushTextMessage(to: string, text: string) {
  try {
    const res = await lineClient.pushMessage({
      to,
      messages: [{ type: "text", text }],
    });
    console.log("LINE push success:", JSON.stringify({ to, text, res }));
  } catch (err) {
    console.error("LINE push failed:", JSON.stringify({ to, text, error: String(err) }));
    throw err;
  }
}

/**
 * グループ宛てに「@全員」メンション付きでテキストを送る。
 * LINEのtextV2形式（{プレースホルダー}＋substitution）を使う。type:"all"のメンションは
 * 個人のuserIdを必要としない（個人メンションと違い、名簿とのuserId紐付けが不要）。
 * 1:1チャット（グループでない宛先）には送らないこと（@全員の意味が成立しない）。
 */
export async function pushGroupMessageWithAllMention(to: string, text: string) {
  const fullText = `{everyone} ${text}`;
  try {
    const res = await lineClient.pushMessage({
      to,
      messages: [
        {
          type: "textV2",
          text: fullText,
          substitution: {
            everyone: { type: "mention", mentionee: { type: "all" } },
          },
        },
      ],
    });
    console.log("LINE push (all mention) success:", JSON.stringify({ to, text, res }));
  } catch (err) {
    console.error(
      "LINE push (all mention) failed:",
      JSON.stringify({ to, text, error: String(err) })
    );
    throw err;
  }
}

export type QuickReplyButton = { label: string; text: string };

export async function replyTextMessage(
  replyToken: string,
  text: string,
  quickReplyButtons?: QuickReplyButton[]
) {
  const quickReply = quickReplyButtons?.length
    ? {
        items: quickReplyButtons.map((b) => ({
          type: "action" as const,
          action: { type: "message" as const, label: b.label, text: b.text },
        })),
      }
    : undefined;

  try {
    const res = await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text, quickReply }],
    });
    console.log("LINE reply success:", JSON.stringify({ text, res }));
  } catch (err) {
    console.error("LINE reply failed:", JSON.stringify({ text, error: String(err) }));
    throw err;
  }
}

/** 許可していないグループにbotが追加された場合、自動的に退出する（機能6） */
export async function leaveGroup(groupId: string) {
  try {
    const res = await lineClient.leaveGroup(groupId);
    console.log("LINE leaveGroup success:", JSON.stringify({ groupId, res }));
  } catch (err) {
    console.error("LINE leaveGroup failed:", JSON.stringify({ groupId, error: String(err) }));
    throw err;
  }
}
