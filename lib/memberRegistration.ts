import { replyTextMessage } from "./line";
import { resolveName } from "./nameResolver";
import { getAllMembers, upsertMember } from "./sheets";

/**
 * 自己申告方式のメンバー登録（グループ内メンション機能の前提）。
 * 「〇〇として登録してください」という決まった言い回しは、管理者かどうかに関わらず
 * 全メンバーに開放する（isAllowedUserのゲートより手前でチェックする）。
 * 名前は誕生日名簿（resolveNameが参照するのと同じ名簿）と照合し、名簿にない名前・
 * 曖昧な表記ゆれは登録させない（＝名簿が実質的なアクセス制御になっている）。
 */

const REGISTER_PATTERN = /^(.+?)として登録してください[。.！!]?$/;

/** メッセージが登録コマンドの形式にマッチするか調べ、マッチすれば入力された名前を返す */
export function parseRegistrationCommand(text: string): string | null {
  const m = text.trim().match(REGISTER_PATTERN);
  return m ? m[1] : null;
}

export async function handleRegistration(
  userId: string,
  replyToken: string,
  inputName: string
): Promise<void> {
  const resolution = await resolveName(inputName);

  if (resolution.status === "no_match") {
    await replyTextMessage(
      replyToken,
      `「${inputName}」さんが名簿に見つかりませんでした。名前を確認してもう一度送ってください。`
    );
    return;
  }

  if (resolution.status === "suggestion") {
    await replyTextMessage(
      replyToken,
      `「${resolution.input}」さんは名簿に見つかりませんでした。もしかして「${resolution.suggestion}」さんですか？正しければ「${resolution.suggestion}として登録してください」ともう一度送ってください。`
    );
    return;
  }

  const name = resolution.name;

  // 他人のuserIdで既に同じ名前が登録されていないか確認する（なりすまし防止）
  const members = await getAllMembers();
  const claimedByOther = members.find((m) => m.name === name && m.userId !== userId);
  if (claimedByOther) {
    await replyTextMessage(
      replyToken,
      `「${name}」さんは既に別のアカウントで登録済みです。心当たりがなければカルチャー局に確認してください。`
    );
    return;
  }

  const result = await upsertMember(userId, name);
  const verb = result === "updated" ? "更新しました" : "登録しました";
  await replyTextMessage(
    replyToken,
    `「${name}」さんとして${verb}！今後、グループ内であなたをメンションする機能に使われます。`
  );
}
