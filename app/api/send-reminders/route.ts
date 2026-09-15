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

  const sentMessages: string[] = [];

  for (const reminder of speechReminders) {
    const message = buildSpeechMessage(reminder);
    await pushTextMessage(targetId, message);
    sentMessages.push(message);
  }

  for (const reminder of birthdayReminders) {
    const message = buildBirthdayMessage(reminder);
    await pushTextMessage(targetId, message);
    sentMessages.push(message);
  }

  return NextResponse.json({ ok: true, sent: sentMessages.length, messages: sentMessages });
}
