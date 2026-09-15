import { NextRequest, NextResponse } from "next/server";
import { pushTextMessage } from "@/lib/line";
import {
  buildBirthdayMessage,
  buildCelebrantGapMessage,
  buildSpeechMessage,
  getBirthdayRemindersForToday,
  getCelebrantGapReminderForToday,
  getSpeechRemindersForToday,
  getTodayJST,
} from "@/lib/reminders";

function getAllowedUserIds(): string[] {
  return (process.env.ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** GitHub Actionsから定時に叩かれるエンドポイント。共有シークレットで認証する。 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targetId = process.env.LINE_TARGET_GROUP_ID;
  if (!targetId) {
    return NextResponse.json({ error: "LINE_TARGET_GROUP_ID is not set" }, { status: 500 });
  }

  const today = getTodayJST();
  const speechReminders = await getSpeechRemindersForToday(today);
  const birthdayReminders = await getBirthdayRemindersForToday(today);

  const groupMessages = [
    ...speechReminders.map(buildSpeechMessage),
    ...birthdayReminders.map(buildBirthdayMessage),
  ];

  // 1件の送信失敗が他のリマインドを巻き込まないよう、それぞれ独立して結果を記録する
  const groupResults = await Promise.allSettled(
    groupMessages.map((message) => pushTextMessage(targetId, message))
  );

  // 祝福者未定チェック（月曜のみ）。グループではなくカルチャー局（許可ユーザー）個別に送る
  const celebrantGaps = await getCelebrantGapReminderForToday(today);
  let celebrantResults: PromiseSettledResult<void>[] = [];
  if (celebrantGaps.length > 0) {
    const message = buildCelebrantGapMessage(celebrantGaps);
    const allowedUserIds = getAllowedUserIds();
    celebrantResults = await Promise.allSettled(
      allowedUserIds.map((userId) => pushTextMessage(userId, message))
    );
  }

  const allResults = [...groupResults, ...celebrantResults];
  const succeeded = allResults.filter((r) => r.status === "fulfilled").length;
  const failed = allResults.filter((r) => r.status === "rejected").length;

  const summary = {
    ok: failed === 0,
    date: today.toISOString().slice(0, 10),
    group: { total: groupMessages.length, messages: groupMessages },
    celebrantGaps: { total: celebrantGaps.length, gaps: celebrantGaps },
    succeeded,
    failed,
  };
  console.log("send-reminders summary:", JSON.stringify(summary));

  return NextResponse.json(summary, { status: failed > 0 ? 207 : 200 });
}
