/** 1:1チャットでの設定変更を許可するLINEユーザーID（カルチャー局メンバー）。カンマ区切りで.envに設定する */
export function isAllowedUser(lineUserId: string | undefined | null): boolean {
  if (!lineUserId) return false;
  const allowed = (process.env.ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(lineUserId);
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
