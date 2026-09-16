import { replyTextMessage, type QuickReplyButton } from "./line";
import { getAllowedGroups } from "./allowlist";
import { addDays, getTodayJST } from "./reminders";
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
 *   → one_time なら await_deadline（イベント・締切の日付＝YYYY/MM/DD）
 *   → recurring なら await_weekday（月〜日のボタン）
 * → await_message（内容を自由入力）
 * → await_group（送信先グループをボタンから選択、または「デフォルトでOK」）
 * → 完了：
 *   - one_time：締切から逆算して複数件（エビングハウス方式）のカスタムリマインドを一括登録
 *   - recurring：addCustomReminderを1件登録
 *   いずれもウィザード状態をクリアして終了
 *
 * どのステップでも「キャンセル」と送ると中断してウィザード状態をクリアする。
 */

type WizardData = {
  reminderType?: CustomReminderType;
  dateOrWeekday?: string; // one_time: 締切日(YYYY/MM/DD)、recurring: 曜日
  message?: string;
};

const CANCEL_BUTTON: QuickReplyButton = { label: "キャンセル", text: "キャンセル" };
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

// 「締切のN日前」に送るリマインドのオフセット一覧（エビングハウスの忘却曲線を参考にした間隔拡大方式）。
// 締切までの残り日数が短い場合、入りきらないオフセットは自動で間引かれる。
const EVENT_REMINDER_OFFSETS_DAYS = [30, 14, 7, 3, 1, 0];

function weekdayButtons(): QuickReplyButton[] {
  return [...WEEKDAYS.map((w) => ({ label: w, text: w })), CANCEL_BUTTON];
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function parseYmd(text: string): Date | null {
  const m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  date.setHours(0, 0, 0, 0);
  return date;
}

/** 締切日から逆算して、送信日とラベル（何日前か）の一覧を作る（過去分は除く） */
function buildEventReminderSchedule(
  deadline: Date,
  today: Date
): { date: Date; offsetDays: number }[] {
  return EVENT_REMINDER_OFFSETS_DAYS.map((offsetDays) => ({
    offsetDays,
    date: addDays(deadline, -offsetDays),
  })).filter((entry) => entry.date >= today);
}

function buildEventReminderMessage(content: string, offsetDays: number): string {
  if (offsetDays === 0) return `【${content}】本日が期限です！`;
  return `【${content}】まであと${offsetDays}日です`;
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
      await setWizardState<WizardData>(userId, "await_deadline", { ...data, reminderType: "one_time" });
      await replyTextMessage(
        replyToken,
        "いつのイベント・締切ですか？（例：2026/12/25）\nそこから逆算して、締切が近づくにつれ複数回リマインドします。",
        [CANCEL_BUTTON]
      );
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

  if (step === "await_deadline") {
    const deadline = parseYmd(t);
    if (!deadline) {
      await replyTextMessage(
        replyToken,
        "日付が読み取れませんでした。「2026/12/25」のような形式で送ってください。",
        [CANCEL_BUTTON]
      );
      return true;
    }
    if (deadline < getTodayJST()) {
      await replyTextMessage(replyToken, "締切は今日以降の日付にしてください。", [CANCEL_BUTTON]);
      return true;
    }
    await setWizardState<WizardData>(userId, "await_message", { ...data, dateOrWeekday: formatYmd(deadline) });
    await replyTextMessage(
      replyToken,
      "そのイベント・締切の内容を教えてください（例：卒論提出、期末レポート提出など）",
      [CANCEL_BUTTON]
    );
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

    if (data.reminderType === "one_time") {
      const deadline = parseYmd(data.dateOrWeekday!)!;
      const schedule = buildEventReminderSchedule(deadline, getTodayJST());

      for (const entry of schedule) {
        await addCustomReminder(
          "one_time",
          formatYmd(entry.date),
          buildEventReminderMessage(data.message!, entry.offsetDays),
          groupLabel
        );
      }
      await clearWizardState(userId);

      const scheduleLines = schedule
        .map((e) => (e.offsetDays === 0 ? `・${formatYmd(e.date)}（当日）` : `・${formatYmd(e.date)}（${e.offsetDays}日前）`))
        .join("\n");
      await replyTextMessage(
        replyToken,
        `「${data.message}」（締切：${data.dateOrWeekday}）のリマインドを${schedule.length}件登録しました！\n${scheduleLines}`
      );
    } else {
      await addCustomReminder("recurring", data.dateOrWeekday!, data.message!, groupLabel);
      await clearWizardState(userId);
      await replyTextMessage(
        replyToken,
        `リマインドを登録しました！毎週${data.dateOrWeekday}曜日に「${data.message}」を送ります。`
      );
    }
    return true;
  }

  // 未知のステップ（データ破損など）に陥った場合は状態をクリアして通常のコマンド解釈に戻す
  await clearWizardState(userId);
  return false;
}
