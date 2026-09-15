import { NextRequest, NextResponse } from "next/server";
import { pushTextMessage } from "@/lib/line";
import {
  buildBirthdayMessage,
  buildSpeechMessage,
  getBirthdayRemindersForToday,
  getSpeechRemindersForToday,
  getTodayJST,
} from "@/lib/reminders";

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

  const messages = [
    ...speechReminders.map(buildSpeechMessage),
    ...birthdayReminders.map(buildBirthdayMessage),
  ];

  // 1件の送信失敗が他のリマインドを巻き込まないよう、それぞれ独立して結果を記録する
  const results = await Promise.allSettled(
    messages.map((message) => pushTextMessage(targetId, message))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  const summary = {
    ok: failed === 0,
    date: today.toISOString().slice(0, 10),
    total: messages.length,
    succeeded,
    failed,
    messages,
  };
  console.log("send-reminders summary:", JSON.stringify(summary));

  return NextResponse.json(summary, { status: failed > 0 ? 207 : 200 });
}
