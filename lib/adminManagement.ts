import { replyTextMessage } from "./line";
import { resolveName } from "./nameResolver";
import { addAdmin, getAllMembers, removeAdmin } from "./sheets";

/**
 * master限定の管理者（admin）加除コマンド。
 * 「〇〇を管理者にしてください」「〇〇の管理者を外してください」という決まった言い回しで操作する。
 * 対象者は事前に自己申告方式で名前登録（lib/memberRegistration.ts）を済ませている必要がある
 * （登録がないとuserIdが分からず、管理者にできないため）。
 * masterかどうかの判定は呼び出し側（webhookハンドラ）で行う。
 */

export type AdminCommand = { action: "add" | "remove"; name: string };

export function parseAdminCommand(text: string): AdminCommand | null {
  const t = text.trim();
  let m = t.match(/^(.+?)を管理者にしてください[。.！!]?$/);
  if (m) return { action: "add", name: m[1] };

  m = t.match(/^(.+?)の管理者を外してください[。.！!]?$/);
  if (m) return { action: "remove", name: m[1] };

  return null;
}

export async function handleAdminCommand(replyToken: string, command: AdminCommand): Promise<void> {
  const resolution = await resolveName(command.name);

  if (resolution.status === "no_match") {
    await replyTextMessage(
      replyToken,
      `「${command.name}」さんが名簿に見つかりませんでした。名前を確認してもう一度送ってください。`
    );
    return;
  }

  if (resolution.status === "suggestion") {
    await replyTextMessage(
      replyToken,
      `「${resolution.input}」さんは名簿に見つかりませんでした。もしかして「${resolution.suggestion}」さんですか？正しければ正確な名前でもう一度送ってください。`
    );
    return;
  }

  const name = resolution.name;
  const members = await getAllMembers();
  const member = members.find((m) => m.name === name);
  if (!member) {
    await replyTextMessage(
      replyToken,
      `「${name}」さんはまだ名前登録（「〇〇として登録してください」）をしていないため、管理者にできません。先にご本人に登録してもらってください。`
    );
    return;
  }

  if (command.action === "add") {
    const result = await addAdmin(member.userId, name);
    await replyTextMessage(
      replyToken,
      result === "already_admin" ? `「${name}」さんは既に管理者です。` : `「${name}」さんを管理者にしました！`
    );
  } else {
    const result = await removeAdmin(member.userId);
    await replyTextMessage(
      replyToken,
      result === "not_admin" ? `「${name}」さんは管理者ではありません。` : `「${name}」さんの管理者権限を外しました。`
    );
  }
}
