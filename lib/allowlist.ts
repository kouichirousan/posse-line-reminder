/** 1:1チャットでの設定変更を許可するLINEユーザーID（カルチャー局メンバー）。カンマ区切りで.envに設定する */
export function isAllowedUser(lineUserId: string | undefined | null): boolean {
  if (!lineUserId) return false;
  const allowed = (process.env.ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(lineUserId);
}
