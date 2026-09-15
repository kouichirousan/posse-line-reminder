import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";
// シート名はGoogleスプレッドシートのタブ名と完全一致させる（実際のタブ名と違ったら.envで調整する）
const SHEET_NAME_100SPEECH =
  process.env.SHEET_NAME_100SPEECH ?? "6期生＆7期生100スピ・birthdayローテ";
const SHEET_NAME_BIRTHDAY = process.env.SHEET_NAME_BIRTHDAY ?? "6期&7期birthday";

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

/** 誕生日名簿を読む（A3以降、B=お祝い日, C=名前） */
export async function getBirthdayRoster(): Promise<BirthdayRow[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!A3:D200`,
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((row) => row[1] && row[2]) // 日付・名前がある行のみ
    .map((row) => ({
      date: row[1] ?? "",
      name: row[2] ?? "",
    }));
}

/**
 * 誕生日名簿に対して、既存の名前があれば日付を更新、なければ新規行を追加する。
 * 1:1チャットからの設定変更（機能3）の最初のユースケースとして実装。
 */
export async function upsertBirthday(name: string, date: string): Promise<"updated" | "added"> {
  const sheets = await getSheetsClient();
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!A3:D200`,
  });
  const rows = readRes.data.values ?? [];
  const existingIndex = rows.findIndex((row) => row[2] === name);

  if (existingIndex !== -1) {
    const rowNumber = existingIndex + 3; // A3始まりなのでオフセット+3
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_NAME_BIRTHDAY}'!B${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date]] },
    });
    return "updated";
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME_BIRTHDAY}'!A3:D200`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [["", date, name, ""]] },
  });
  return "added";
}
