import { getBirthdayRoster, getSpeechRoster } from "./sheets";

/** サーバーのタイムゾーンに関わらず、日本時間での「今日」を返す */
export function getTodayJST(): Date {
  const now = new Date();
  const jstString = now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
  const jst = new Date(jstString);
  jst.setHours(0, 0, 0, 0);
  return jst;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** "5/11" のような M/D 文字列を、基準年(baseYear)の月日として比較用に正規化する */
function parseMonthDayOnly(text: string): { month: number; day: number } | null {
  const match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  return { month: Number(match[1]), day: Number(match[2]) };
}

/** "2007/04/09" のような YYYY/MM/DD 文字列から月日だけを取り出す */
function parseYmdMonthDay(text: string): { month: number; day: number } | null {
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  return { month: Number(match[2]), day: Number(match[3]) };
}

function sameMonthDay(a: { month: number; day: number }, b: Date): boolean {
  return a.month === b.getMonth() + 1 && a.day === b.getDate();
}

export type SpeechReminder = { kind: "speech"; targetDate: Date; speakers: string[] };
export type BirthdayReminder = { kind: "birthday"; targetDate: Date; name: string };

/**
 * 今日送るべき100秒スピーチのリマインドを判定する。
 * 火曜日：次のMU（月曜、6日後）の担当者を早めに通知
 * 日曜日：翌日のMU（月曜）の担当者を直前通知
 */
export async function getSpeechRemindersForToday(today: Date): Promise<SpeechReminder[]> {
  const dayOfWeek = today.getDay(); // 0=日, 2=火
  let targetDate: Date | null = null;
  if (dayOfWeek === 2) targetDate = addDays(today, 6); // 火曜 → 次の月曜
  if (dayOfWeek === 0) targetDate = addDays(today, 1); // 日曜 → 翌日の月曜
  if (!targetDate) return [];

  const roster = await getSpeechRoster();
  const matches = roster.filter((row) => {
    const md = parseMonthDayOnly(row.date);
    return md && sameMonthDay(md, targetDate as Date);
  });

  return matches.map((row) => ({
    kind: "speech" as const,
    targetDate: targetDate as Date,
    speakers: row.speakers,
  }));
}

/**
 * 今日送るべき誕生日リマインドを判定する。
 * N日前（デフォルト7日、BIRTHDAY_ADVANCE_DAYSで変更可）：早めの通知
 * 1日前：直前通知
 */
export async function getBirthdayRemindersForToday(today: Date): Promise<BirthdayReminder[]> {
  const advanceDays = Number(process.env.BIRTHDAY_ADVANCE_DAYS ?? "7");
  const advanceTarget = addDays(today, advanceDays);
  const dayBeforeTarget = addDays(today, 1);

  const roster = await getBirthdayRoster();
  const reminders: BirthdayReminder[] = [];

  for (const row of roster) {
    const md = parseYmdMonthDay(row.date);
    if (!md) continue;
    if (sameMonthDay(md, advanceTarget)) {
      reminders.push({ kind: "birthday", targetDate: advanceTarget, name: row.name });
    }
    if (sameMonthDay(md, dayBeforeTarget)) {
      reminders.push({ kind: "birthday", targetDate: dayBeforeTarget, name: row.name });
    }
  }
  return reminders;
}

function formatMD(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function buildSpeechMessage(reminder: SpeechReminder): string {
  return `【100秒スピーチ】次回MU（${formatMD(reminder.targetDate)}）の担当は ${reminder.speakers.join("・")} さんです！準備よろしくお願いします🎤`;
}

export function buildBirthdayMessage(reminder: BirthdayReminder): string {
  return `【お誕生日】${formatMD(reminder.targetDate)}は ${reminder.name} さんの誕生日です🎉 お祝いの準備をお願いします！`;
}
