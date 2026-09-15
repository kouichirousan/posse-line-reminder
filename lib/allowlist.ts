/** 1:1チャットでの設定変更を許可するLINEユーザーID（カルチャー局メンバー）。カンマ区切りで.envに設定する */
export function isAllowedUser(lineUserId: string | undefined | null): boolean {
  if (!lineUserId) return false;
  const allowed = (process.env.ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(lineUserId);
}

/**
 * botの参加を許可するグループID。
 * LINE_TARGET_GROUP_ID（このbotが本来サービスする対象グループ）と一致するかで判定する（機能6）。
 * 将来的に複数グループを許可したい場合は ALLOWED_GROUP_IDS（カンマ区切り）で上書きできる。
 */
export function isAllowedGroup(groupId: string | undefined | null): boolean {
  if (!groupId) return false;
  const explicitList = (process.env.ALLOWED_GROUP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (explicitList.length > 0) return explicitList.includes(groupId);

  const targetGroupId = process.env.LINE_TARGET_GROUP_ID;
  return !!targetGroupId && groupId === targetGroupId;
}
