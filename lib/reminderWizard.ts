import { replyTextMessage, type QuickReplyButton } from "./line";
import { getAllowedGroups } from "./allowlist";
import {
  addCustomReminder,
  clearWizardState,
  getWizardState,
  setWizardState,
  type CustomReminderType,
} from "./sheets";

/**
 * リマインド作成を「1項目ずつ質問して埋めていく」対話形式（ウィザード）で行う。
 * LINE Webhookは1メッセージごとに独立しているため、途中経過はSheets側の
 * 「会話状態」タブに保存し（lib/sheets.ts）、次のメッセージが来たらそこから再開する。
 *
 * ステップ遷移：
 * await_type（1回限り／毎週）
 *   → one_time なら await_date（YYYY/MM/DD）
 *   → recurring なら await_weekday（月〜日のボタン）
 * → await_message（内容を自由入力）
 * → await_group（送信先グループをボタンから選択、または「デフォルトでOK」）
 * → 完了：addCustomReminderを呼んでウィザード状態をクリア
 *
 * どのステップでも「キャンセル」と送ると中断してウィザード状態をクリアする。
 */

type WizardData = {
  reminderType?: CustomReminderType;
  dateOrWeekday?: string;
  message?: string;
};

const CANCEL_BUTTON: QuickReplyButton = { label: "キャンセル", text: "キャンセル" };
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

function weekdayButtons(): QuickReplyButton[] {
  return [...WEEKDAYS.map((w) => ({ label: w, text: w })), CANCEL_BUTTON];
}

/** メニューの「リマインド作成」ボタンから呼ばれる、ウィザードの開始地点 */
export async function startReminderWizard(userId: string, replyToken: string): Promise<void> {
  await setWizardState<WizardData>(userId, "await_type", {});
  await replyTextMessage(replyToken, "リマインドを作成します。いつ送りますか？", [
    { label: "1回限り", text: "1回限り" },
    { label: "毎週", text: "毎週" },
    CANCEL_BUTTON,
  ]);
}

/** ユーザーがウィザード進行中かどうかを調べ、進行中ならそのメッセージをウィザードに渡す */
export async function continueReminderWizardIfActive(
  userId: string,
  text: string,
  replyToken: string
): Promise<boolean> {
  const state = await getWizardState<WizardData>(userId);
  if (!state) return false;

  const t = text.trim();
  if (t === "キャンセル") {
    await clearWizardState(userId);
    await replyTextMessage(replyToken, "リマインド作成をキャンセルしました。");
    return true;
  }

  const { step, data } = state;

  if (step === "await_type") {
    if (t === "1回限り") {
      await setWizardState<WizardData>(userId, "await_date", { ...data, reminderType: "one_time" });
      await replyTextMessage(replyToken, "いつ送りますか？（例：2026/12/25）", [CANCEL_BUTTON]);
    } else if (t === "毎週") {
      await setWizardState<WizardData>(userId, "await_weekday", { ...data, reminderType: "recurring" });
      await replyTextMessage(replyToken, "何曜日に送りますか？", weekdayButtons());
    } else {
      await replyTextMessage(replyToken, "「1回限り」か「毎週」のボタンから選んでください。", [
        { label: "1回限り", text: "1回限り" },
        { label: "毎週", text: "毎週" },
        CANCEL_BUTTON,
      ]);
    }
    return true;
  }

  if (step === "await_date") {
    const m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) {
      await replyTextMessage(
        replyToken,
        "日付が読み取れませんでした。「2026/12/25」のような形式で送ってください。",
        [CANCEL_BUTTON]
      );
      return true;
    }
    const [, y, mo, d] = m;
    const dateOrWeekday = `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}`;
    await setWizardState<WizardData>(userId, "await_message", { ...data, dateOrWeekday });
    await replyTextMessage(replyToken, "リマインドの内容を教えてください（例：忘年会があります）", [
      CANCEL_BUTTON,
    ]);
    return true;
  }

  if (step === "await_weekday") {
    if (!WEEKDAYS.includes(t)) {
      await replyTextMessage(replyToken, "曜日をボタンから選んでください。", weekdayButtons());
      return true;
    }
    await setWizardState<WizardData>(userId, "await_message", { ...data, dateOrWeekday: t });
    await replyTextMessage(replyToken, "リマインドの内容を教えてください（例：忘年会があります）", [
      CANCEL_BUTTON,
    ]);
    return true;
  }

  if (step === "await_message") {
    if (!t) {
      await replyTextMessage(replyToken, "内容を入力してください。", [CANCEL_BUTTON]);
      return true;
    }
    await setWizardState<WizardData>(userId, "await_group", { ...data, message: t });
    const groups = getAllowedGroups();
    const groupButtons: QuickReplyButton[] = [
      ...groups.map((g) => ({ label: g.label, text: g.label })),
      { label: "デフォルトでOK", text: "デフォルトでOK" },
      CANCEL_BUTTON,
    ];
    await replyTextMessage(replyToken, "送信先グループを選んでください。", groupButtons);
    return true;
  }

  if (step === "await_group") {
    const groups = getAllowedGroups();
    const matched = groups.find((g) => g.label === t);
    if (t !== "デフォルトでOK" && !matched) {
      const groupButtons: QuickReplyButton[] = [
        ...groups.map((g) => ({ label: g.label, text: g.label })),
        { label: "デフォルトでOK", text: "デフォルトでOK" },
        CANCEL_BUTTON,
      ];
      await replyTextMessage(replyToken, "グループをボタンから選んでください。", groupButtons);
      return true;
    }

    const groupLabel = matched ? matched.label : groups[0]?.label ?? "";
    await addCustomReminder(data.reminderType!, data.dateOrWeekday!, data.message!, groupLabel);
    await clearWizardState(userId);

    const typeLabel =
      data.reminderType === "one_time" ? `${data.dateOrWeekday}に1回限り` : `毎週${data.dateOrWeekday}曜日に`;
    await replyTextMessage(replyToken, `リマインドを登録しました！${typeLabel}「${data.message}」を送ります。`);
    return true;
  }

  // 未知のステップ（データ破損など）に陥った場合は状態をクリアして通常のコマンド解釈に戻す
  await clearWizardState(userId);
  return false;
}
