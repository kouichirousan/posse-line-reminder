import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";
// シート名はGoogleスプレッドシートのタブ名と完全一致させる（実際のタブ名と違ったら.envで調整する）
// 100スピシートのタブ名は末尾に半角スペースが付いているのが実物の正式名称（2026-09-16確認）
const SHEET_NAME_100SPEECH =
  process.env.SHEET_NAME_100SPEECH ?? "6期生＆7期生100スピ・birthdayローテ ";
const SHEET_NAME_BIRTHDAY = process.env.SHEET_NAME_BIRTHDAY ?? "6期&7期birthday";
// カスタムリマインド用のタブ。存在しなければ自動で作成する
const SHEET_NAME_CUSTOM_REMINDERS = process.env.SHEET_NAME_CUSTOM_REMINDERS ?? "カスタムリマインド";
// リマインド作成ウィザード（質問形式）の進行状態を保持するタブ。存在しなければ自動で作成する
const SHEET_NAME_WIZARD_STATE = process.env.SHEET_NAME_WIZARD_STATE ?? "会話状態";

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY が未設定です");
  }
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

export type SpeechRow = {
  round: string;
  date: string; // 例: "5/11"（年なし、M/D形式）
  speakers: string[]; // 2人ペア想定
};

export type BirthdayRow = {
  date: string; // 例: "2007/04/09"
  name: string;
};

/** 100秒スピーチのローテ表を読む（A3以降、A=回, B=日付, C・D=担当者名） */
export async function getSpeechRoster(): Promise<SpeechRow[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!A3:D200`,
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((row) => row[1]) // 日付がある行のみ
    .map((row) => ({
      round: row[0] ?? "",
      date: row[1] ?? "",
      speakers: [row[2], row[3]].filter(Boolean) as string[],
    }));
}

/**
 * 誕生日名簿を読む。
 * 実物のシート構造（2026-09-16確認）：B列=一覧番号, C列=お祝い日, D列=空, E列=名前
 * （ヘッダー行の表示位置とは1列ズレているが、実データはこの並び）
 */
export async function getBirthdayRoster(): Promise<BirthdayRow[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!B3:E200`,
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((row) => row[1] && row[3]) // 日付・名前がある行のみ
    .map((row) => ({
      date: row[1] ?? "",
      name: row[3] ?? "",
    }));
}

/**
 * 誕生日名簿に対して、既存の名前があれば日付を更新、なければ新規行を追加する。
 * 1:1チャットからの設定変更（機能3）の最初のユースケースとして実装。
 * 列構成はgetBirthdayRosterと同じ（B=一覧番号, C=お祝い日, D=空, E=名前）
 */
export async function upsertBirthday(name: string, date: string): Promise<"updated" | "added"> {
  const sheets = await getSheetsClient();
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!B3:E200`,
  });
  const rows = readRes.data.values ?? [];
  const existingIndex = rows.findIndex((row) => row[3] === name);

  if (existingIndex !== -1) {
    const rowNumber = existingIndex + 3; // B3始まりなのでオフセット+3
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_NAME_BIRTHDAY}'!C${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date]] },
    });
    return "updated";
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!B3:E200`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [["", date, "", name]] },
  });
  return "added";
}

/**
 * 100秒スピーチの担当者を変更する。
 * 対象の日付（M/D形式、ローテ表のB列と一致）の行を探し、C・D列（担当者名）を上書きする。
 * 該当する日付の回がなければ "not_found" を返す（新規追加はしない。ローテ自体の追加は範囲外）。
 */
export async function setSpeechSpeakers(
  date: string,
  speakers: string[]
): Promise<"updated" | "not_found"> {
  const sheets = await getSheetsClient();
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!A3:D200`,
  });
  const rows = readRes.data.values ?? [];
  const existingIndex = rows.findIndex((row) => row[1] === date);

  if (existingIndex === -1) return "not_found";

  const rowNumber = existingIndex + 3; // A3始まりなのでオフセット+3
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!C${rowNumber}:D${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[speakers[0] ?? "", speakers[1] ?? ""]] },
  });
  return "updated";
}

/**
 * 祝福者機能（機能5）関連。
 * 100スピシートのI列＝その週の誕生日リスト（改行区切り、各行「名前M/D」形式）、
 * J列＝祝福者リストで、I列・J列は同じ行インデックスで対応している（例：I列1行目の人の祝福者はJ列1行目）。
 * J列の1エントリ内で複数人祝福者がいる場合は「、」区切りで扱う。
 */

export type CelebrantGap = {
  name: string; // 誕生日の人
  date: string; // M/D
  rowDate: string; // その回（週）のMU日付
};

function parseBirthdayEntry(entry: string): { name: string; date: string } | null {
  const match = entry.trim().match(/^(.+?)\s*(\d{1,2}\/\d{1,2})$/);
  if (!match) return null;
  return { name: match[1].trim(), date: match[2] };
}

type CelebrantLocation = {
  rowNumber: number;
  lineIndex: number;
  celebrantLines: string[];
};

async function findCelebrantLocation(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  personName: string
): Promise<CelebrantLocation | null> {
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!A3:J200`,
  });
  const rows = readRes.data.values ?? [];

  for (let r = 0; r < rows.length; r++) {
    const bdRaw = rows[r][8] ?? ""; // I列（0始まりでindex8）
    if (!bdRaw) continue;
    const bdEntries = bdRaw.split("\n").map((s: string) => s.trim());
    const lineIndex = bdEntries.findIndex((e: string) => parseBirthdayEntry(e)?.name === personName);
    if (lineIndex === -1) continue;

    const celebrantRaw = rows[r][9] ?? ""; // J列（index9）
    const celebrantLines = celebrantRaw.split("\n");
    while (celebrantLines.length < bdEntries.length) celebrantLines.push("");

    return { rowNumber: r + 3, lineIndex, celebrantLines };
  }
  return null;
}

async function writeCelebrantLines(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  rowNumber: number,
  celebrantLines: string[]
) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!J${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[celebrantLines.join("\n")]] },
  });
}

/** 指定した誕生日の人の祝福者リストに、名前を追加する */
export async function addCelebrant(
  personName: string,
  celebrantName: string
): Promise<"added" | "already_exists" | "person_not_found"> {
  const sheets = await getSheetsClient();
  const location = await findCelebrantLocation(sheets, personName);
  if (!location) return "person_not_found";

  const { rowNumber, lineIndex, celebrantLines } = location;
  const names = celebrantLines[lineIndex]
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes(celebrantName)) return "already_exists";

  names.push(celebrantName);
  celebrantLines[lineIndex] = names.join("、");
  await writeCelebrantLines(sheets, rowNumber, celebrantLines);
  return "added";
}

/** 指定した誕生日の人の祝福者リストから、名前を削除する */
export async function removeCelebrant(
  personName: string,
  celebrantName: string
): Promise<"removed" | "celebrant_not_found" | "person_not_found"> {
  const sheets = await getSheetsClient();
  const location = await findCelebrantLocation(sheets, personName);
  if (!location) return "person_not_found";

  const { rowNumber, lineIndex, celebrantLines } = location;
  const names = celebrantLines[lineIndex]
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.includes(celebrantName)) return "celebrant_not_found";

  celebrantLines[lineIndex] = names.filter((n) => n !== celebrantName).join("、");
  await writeCelebrantLines(sheets, rowNumber, celebrantLines);
  return "removed";
}

/**
 * 今日から指定日数以内に誕生日が来るのに、祝福者がまだ1人も決まっていない人の一覧を返す。
 * （年をまたぐ場合の簡易対応込み）
 */
export async function getUpcomingCelebrantGaps(
  today: Date,
  daysAhead: number
): Promise<CelebrantGap[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_100SPEECH}'!A3:J200`,
  });
  const rows = res.data.values ?? [];
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + daysAhead);

  const gaps: CelebrantGap[] = [];

  for (const row of rows) {
    const rowDate = row[1] ?? "";
    const bdRaw = row[8] ?? "";
    if (!bdRaw) continue;
    const bdEntries = bdRaw
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const celebrantRaw = row[9] ?? "";
    const celebrantEntries = celebrantRaw.split("\n").map((s: string) => s.trim());

    bdEntries.forEach((entry: string, i: number) => {
      const parsed = parseBirthdayEntry(entry);
      if (!parsed) return;
      const hasCelebrant = !!(celebrantEntries[i] && celebrantEntries[i].length > 0);
      if (hasCelebrant) return;

      const [m, d] = parsed.date.split("/").map(Number);
      const bdDate = new Date(today.getFullYear(), m - 1, d);
      if (bdDate < today) bdDate.setFullYear(bdDate.getFullYear() + 1);
      if (bdDate >= today && bdDate <= endDate) {
        gaps.push({ name: parsed.name, date: parsed.date, rowDate });
      }
    });
  }

  return gaps;
}

/**
 * カスタムリマインド機能。
 * 「カスタムリマインド」タブに、1行1リマインドとして保存する。
 * 列構成：A=種類(one_time/recurring), B=日付(YYYY/MM/DD)または曜日(月〜日), C=メッセージ, D=送信先ラベル, E=送信済み(TRUE/FALSE、one_timeのみ使用)
 * タブが存在しなければ自動的に作成する。
 */

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

export type CustomReminderType = "one_time" | "recurring";

export type DueCustomReminder = {
  rowNumber: number;
  message: string;
  groupLabel: string;
  type: CustomReminderType;
};

async function ensureCustomReminderSheetExists(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === SHEET_NAME_CUSTOM_REMINDERS
  );
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: SHEET_NAME_CUSTOM_REMINDERS } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_CUSTOM_REMINDERS}'!A1:E1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["種類", "日付(YYYY/MM/DD)または曜日", "メッセージ", "送信先ラベル", "送信済み"]],
    },
  });
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

/** 新しいカスタムリマインドを1件追加する */
export async function addCustomReminder(
  type: CustomReminderType,
  dateOrWeekday: string,
  message: string,
  groupLabel: string
): Promise<void> {
  const sheets = await getSheetsClient();
  await ensureCustomReminderSheetExists(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_CUSTOM_REMINDERS}'!A2:E200`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[type, dateOrWeekday, message, groupLabel, "FALSE"]] },
  });
}

/** 今日送るべきカスタムリマインドを判定する（1回限り：日付一致かつ未送信／定期：曜日一致） */
export async function getDueCustomReminders(today: Date): Promise<DueCustomReminder[]> {
  const sheets = await getSheetsClient();
  await ensureCustomReminderSheetExists(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_CUSTOM_REMINDERS}'!A2:E200`,
  });
  const rows = res.data.values ?? [];
  const todayStr = formatYmd(today);
  const todayWeekday = WEEKDAY_NAMES[today.getDay()];

  const due: DueCustomReminder[] = [];
  rows.forEach((row, i) => {
    const [type, dateOrWeekday, message, groupLabel, sent] = row;
    if (!type || !message) return;

    if (type === "one_time" && dateOrWeekday === todayStr && sent !== "TRUE") {
      due.push({ rowNumber: i + 2, message, groupLabel: groupLabel ?? "", type: "one_time" });
    } else if (type === "recurring" && dateOrWeekday === todayWeekday) {
      due.push({ rowNumber: i + 2, message, groupLabel: groupLabel ?? "", type: "recurring" });
    }
  });
  return due;
}

/** 1回限りのカスタムリマインドを送信済みにする（二重送信防止） */
export async function markCustomReminderSent(rowNumber: number): Promise<void> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_CUSTOM_REMINDERS}'!E${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["TRUE"]] },
  });
}

/**
 * リマインド作成ウィザード（1メッセージずつ項目を質問して埋めていく対話形式）の進行状態。
 * LINE Webhookはリクエストごとに独立している（会話の記憶を持たない）ため、
 * 「このユーザーは今どの質問の途中か」をスプレッドシートに保存して次のメッセージで読み出す。
 * 列構成：A=userId, B=ステップ名, C=途中まで埋めたデータ(JSON文字列), D=最終更新日時(ISO)
 * ステップが空欄（B列が空）の行は「進行中のウィザードなし」を意味する。
 */

const WIZARD_STATE_TTL_MS = 30 * 60 * 1000; // 30分以上放置されたら期限切れとして扱う

export type WizardState<T> = { rowNumber: number; step: string; data: T };

async function ensureWizardStateSheetExists(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME_WIZARD_STATE);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: SHEET_NAME_WIZARD_STATE } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!A1:D1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["userId", "ステップ", "データ(JSON)", "最終更新日時"]] },
  });
}

/** 指定ユーザーの進行中のウィザード状態を読む。期限切れ・未着手なら null */
export async function getWizardState<T>(userId: string): Promise<WizardState<T> | null> {
  const sheets = await getSheetsClient();
  await ensureWizardStateSheetExists(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!A2:D1000`,
  });
  const rows = res.data.values ?? [];
  const index = rows.findIndex((row) => row[0] === userId);
  if (index === -1) return null;

  const [, step, dataJson, updatedAt] = rows[index];
  if (!step) return null;
  if (updatedAt && Date.now() - new Date(updatedAt).getTime() > WIZARD_STATE_TTL_MS) return null;

  try {
    return { rowNumber: index + 2, step, data: dataJson ? JSON.parse(dataJson) : ({} as T) };
  } catch {
    return null;
  }
}

/** 指定ユーザーのウィザード状態を保存する（既存行があれば上書き、なければ新規追加） */
export async function setWizardState<T>(userId: string, step: string, data: T): Promise<void> {
  const sheets = await getSheetsClient();
  await ensureWizardStateSheetExists(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!A2:A1000`,
  });
  const rows = res.data.values ?? [];
  const index = rows.findIndex((row) => row[0] === userId);
  const values = [[userId, step, JSON.stringify(data), new Date().toISOString()]];

  if (index !== -1) {
    const rowNumber = index + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_NAME_WIZARD_STATE}'!A${rowNumber}:D${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!A2:D1000`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/** 指定ユーザーのウィザード状態を消す（キャンセル・完了時）。行自体は使い回すため中身だけ空にする */
export async function clearWizardState(userId: string): Promise<void> {
  const sheets = await getSheetsClient();
  await ensureWizardStateSheetExists(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!A2:A1000`,
  });
  const rows = res.data.values ?? [];
  const index = rows.findIndex((row) => row[0] === userId);
  if (index === -1) return;

  const rowNumber = index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_WIZARD_STATE}'!B${rowNumber}:D${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["", "", ""]] },
  });
}
