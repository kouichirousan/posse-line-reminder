import { NextRequest, NextResponse } from "next/server";
import type { webhook } from "@line/bot-sdk";
import { verifyLineSignature, replyTextMessage, leaveGroup } from "@/lib/line";
import { isAllowedUser, isAllowedGroup } from "@/lib/allowlist";
import { parseCommand } from "@/lib/parseCommand";
import { setSpeechSpeakers, upsertBirthday } from "@/lib/sheets";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as webhook.CallbackRequest;

  for (const event of body.events) {
    // セットアップ確認用：グループ/ユーザーのIDをログに出す（Vercelのログで確認できる）
    console.log("LINE event:", JSON.stringify(event));

    // 機能6：許可していないグループに追加された場合は自動的に退出する
    if (event.type === "join" && event.source?.type === "group") {
      const groupId = event.source.groupId;
      if (!isAllowedGroup(groupId)) {
        console.log("Unauthorized group, leaving:", JSON.stringify({ groupId }));
        if (groupId) await leaveGroup(groupId);
      } else {
        console.log("Authorized group join:", JSON.stringify({ groupId }));
      }
      continue;
    }

    if (event.type !== "message" || event.message.type !== "text") continue;

    // グループチャットでのメッセージには反応しない（1:1チャットでの設定機能のみ対応）
    if (event.source?.type !== "user") continue;

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const text = event.message.text;

    if (!replyToken) continue;

    if (!isAllowedUser(userId)) {
      await replyTextMessage(replyToken, "すみません、この操作は許可されたメンバーのみ利用できます。");
      continue;
    }

    const command = await parseCommand(text);

    if (command.action === "set_birthday") {
      const result = await upsertBirthday(command.name, command.date);
      const verb = result === "added" ? "登録しました" : "更新しました";
      await replyTextMessage(
        replyToken,
        `${command.name}さんの誕生日（${command.date}）を${verb}！`
      );
    } else if (command.action === "set_speech_speaker") {
      const result = await setSpeechSpeakers(command.date, command.speakers);
      if (result === "updated") {
        await replyTextMessage(
          replyToken,
          `${command.date}の100秒スピーチ担当を${command.speakers.join("・")}さんに変更しました！`
        );
      } else {
        await replyTextMessage(
          replyToken,
          `${command.date}の回がローテ表に見つかりませんでした。日付を確認してもう一度送ってください。`
        );
      }
    } else {
      await replyTextMessage(
        replyToken,
        "うまく読み取れませんでした。「〇〇さんの誕生日は2026/5/1です」「5/25の100スピ担当を〇〇に変更してください」のように送ってください。"
      );
    }
  }

  return NextResponse.json({ ok: true });
}
