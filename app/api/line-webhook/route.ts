import { NextRequest, NextResponse } from "next/server";
import type { webhook } from "@line/bot-sdk";
import { verifyLineSignature, replyTextMessage, leaveGroup } from "@/lib/line";
import { isAllowedUser, isAllowedGroup } from "@/lib/allowlist";
import { parseCommand } from "@/lib/parseCommand";
import { addCelebrant, removeCelebrant, setSpeechSpeakers, upsertBirthday } from "@/lib/sheets";
import { resolveName } from "@/lib/nameResolver";

/**
 * 名簿と照合し、完全一致ならその名前を返す。表記ゆれ候補が見つかった場合は
 * 確認を促す返信を送って null を返す（呼び出し側は処理を中断する）。
 * 該当者がいなければ「見つかりません」と返信して null を返す。
 */
async function resolveOrReply(replyToken: string, inputName: string): Promise<string | null> {
  const resolution = await resolveName(inputName);
  if (resolution.status === "exact") return resolution.name;

  if (resolution.status === "suggestion") {
    await replyTextMessage(
      replyToken,
      `「${resolution.input}」さんは名簿に見つかりませんでした。もしかして「${resolution.suggestion}」さんですか？正しければ、正確な名前でもう一度送ってください。`
    );
    return null;
  }

  await replyTextMessage(
    replyToken,
    `「${resolution.input}」さんが名簿に見つかりませんでした。名前を確認してもう一度送ってください。`
  );
  return null;
}

/** 1:1チャットのテキストメッセージ1件を処理する。エラーはこの関数の外側（呼び出し側）でまとめて捕捉する。 */
async function handleUserMessage(userId: string | undefined, replyToken: string, text: string) {
  if (!isAllowedUser(userId)) {
    await replyTextMessage(replyToken, "すみません、この操作は許可されたメンバーのみ利用できます。");
    return;
  }

  const command = await parseCommand(text);

  if (command.action === "set_birthday") {
    const result = await upsertBirthday(command.name, command.date);
    const verb = result === "added" ? "登録しました" : "更新しました";
    await replyTextMessage(replyToken, `${command.name}さんの誕生日（${command.date}）を${verb}！`);
  } else if (command.action === "set_speech_speaker") {
    // 担当者名を名簿と照合（表記ゆれがあれば確認を促して中断）
    const resolvedSpeakers: string[] = [];
    for (const speaker of command.speakers) {
      const resolved = await resolveOrReply(replyToken, speaker);
      if (!resolved) return;
      resolvedSpeakers.push(resolved);
    }

    const result = await setSpeechSpeakers(command.date, resolvedSpeakers);
    if (result === "updated") {
      await replyTextMessage(
        replyToken,
        `${command.date}の100秒スピーチ担当を${resolvedSpeakers.join("・")}さんに変更しました！`
      );
    } else {
      await replyTextMessage(
        replyToken,
        `${command.date}の回がローテ表に見つかりませんでした。日付を確認してもう一度送ってください。`
      );
    }
  } else if (command.action === "add_celebrant") {
    const personName = await resolveOrReply(replyToken, command.personName);
    if (!personName) return;
    const celebrantName = await resolveOrReply(replyToken, command.celebrantName);
    if (!celebrantName) return;

    const result = await addCelebrant(personName, celebrantName);
    if (result === "added") {
      await replyTextMessage(replyToken, `${personName}さんの祝福者に${celebrantName}さんを追加しました！`);
    } else if (result === "already_exists") {
      await replyTextMessage(replyToken, `${celebrantName}さんは既に${personName}さんの祝福者に入っています。`);
    } else {
      await replyTextMessage(
        replyToken,
        `${personName}さんが誕生日リストに見つかりませんでした（名簿には存在しますが、この回の誕生日リストには載っていないようです）。`
      );
    }
  } else if (command.action === "remove_celebrant") {
    const personName = await resolveOrReply(replyToken, command.personName);
    if (!personName) return;
    const celebrantName = await resolveOrReply(replyToken, command.celebrantName);
    if (!celebrantName) return;

    const result = await removeCelebrant(personName, celebrantName);
    if (result === "removed") {
      await replyTextMessage(replyToken, `${personName}さんの祝福者から${celebrantName}さんを削除しました。`);
    } else if (result === "celebrant_not_found") {
      await replyTextMessage(replyToken, `${celebrantName}さんは${personName}さんの祝福者に入っていませんでした。`);
    } else {
      await replyTextMessage(
        replyToken,
        `${personName}さんが誕生日リストに見つかりませんでした（名簿には存在しますが、この回の誕生日リストには載っていないようです）。`
      );
    }
  } else {
    await replyTextMessage(
      replyToken,
      "うまく読み取れませんでした。「〇〇さんの誕生日は2026/5/1です」「5/25の100スピ担当を〇〇に変更してください」「〇〇さんの祝福者に△△を追加して」のように送ってください。"
    );
  }
}

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

    try {
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

      const replyToken = event.replyToken;
      if (!replyToken) continue;

      await handleUserMessage(event.source.userId, replyToken, event.message.text);
    } catch (err) {
      // Anthropic APIのエラーやSheets APIの一時的な失敗などで処理が落ちても、
      // 無言で終わらせずに本人へフォールバック返信する
      console.error("Error handling LINE event:", JSON.stringify({ event, error: String(err) }));
      if (event.type === "message" && event.replyToken) {
        try {
          await replyTextMessage(
            event.replyToken,
            "すみません、うまく処理できませんでした。少し時間を置いてもう一度送ってください。"
          );
        } catch (replyErr) {
          console.error("Fallback reply also failed:", String(replyErr));
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
