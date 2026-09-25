import { getAllAdmins } from "./sheets";

/**
 * ロールは master（本多晃一朗、MASTER_LINE_USER_IDで固定指定の1人のみ）／
 * admin（masterがチャットから加除する。実体は「管理者」シートタブ）／一般 の3階層。
 * masterはadminの操作をすべて行える（admin以上として扱う）。
 */

/** masterかどうか（.envのMASTER_LINE_USER_IDと一致するか） */
export function isMaster(lineUserId: string | undefined | null): boolean {
  if (!lineUserId) return false;
  const masterId = process.env.MASTER_LINE_USER_ID;
  return !!masterId && lineUserId === masterId;
}

/** admin（管理者シートタブに登録されているか）かどうか。masterは含まない */
export async function isAdmin(lineUserId: string | undefined | null): Promise<boolean> {
  if (!lineUserId) return false;
  const admins = await getAllAdmins();
  return admins.some((a) => a.userId === lineUserId);
}

/** master または admin かどうか（1:1チャットでの既存の管理者向け機能はこれで判定する） */
export async function isAdminOrMaster(lineUserId: string | undefined | null): Promise<boolean> {
  if (!lineUserId) return false;
  if (isMaster(lineUserId)) return true;
  return isAdmin(lineUserId);
}

/** 通知（祝福者未定アラート等）を送るべき相手のuserId一覧。master＋管理者全員 */
export async function getNotificationRecipientUserIds(): Promise<string[]> {
  const admins = await getAllAdmins();
  const ids = admins.map((a) => a.userId);
  const masterId = process.env.MASTER_LINE_USER_ID;
  if (masterId) ids.push(masterId);
  return [...new Set(ids)];
}

export type AllowedGroup = { label: string; groupId: string };

/**
 * botの参加・送信を許可するグループの一覧を返す。
 * ALLOWED_GROUP_IDS を「ラベル:グループID」のカンマ区切りで設定する（例：熱中ターム:C123,別グループ:C456）。
 * ラベルを省略した場合（IDのみ）は、そのIDをラベルとしても扱う。
 * ALLOWED_GROUP_IDSが未設定なら、LINE_TARGET_GROUP_ID を「デフォルト」というラベルの唯一のグループとして扱う。
 */
export function getAllowedGroups(): AllowedGroup[] {
  const entries = (process.env.ALLOWED_GROUP_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length > 0) {
    return entries.map((entry) => {
      if (entry.includes(":")) {
        const [label, groupId] = entry.split(":");
        return { label: label.trim(), groupId: groupId.trim() };
      }
      return { label: entry, groupId: entry };
    });
  }

  const targetGroupId = process.env.LINE_TARGET_GROUP_ID;
  return targetGroupId ? [{ label: "デフォルト", groupId: targetGroupId }] : [];
}

/** botの参加を許可するグループIDかどうか（機能6：許可外グループからの自動退出用） */
export function isAllowedGroup(groupId: string | undefined | null): boolean {
  if (!groupId) return false;
  return getAllowedGroups().some((g) => g.groupId === groupId);
}

/**
 * ラベルからグループIDを解決する。ラベル未指定・該当なしの場合は先頭（デフォルト）のグループにフォールバックする。
 * 許可グループが1つも設定されていなければ null。
 */
export function resolveGroupId(label: string | undefined | null): string | null {
  const groups = getAllowedGroups();
  if (groups.length === 0) return null;
  if (!label) return groups[0].groupId;
  const found = groups.find((g) => g.label === label);
  return (found ?? groups[0]).groupId;
}
