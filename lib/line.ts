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
  await lineClient.pushMessage({
    to,
    messages: [{ type: "text", text }],
  });
}

export async function replyTextMessage(replyToken: string, text: string) {
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}
