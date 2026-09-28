export type AccountLoginState = {
  role: string;
  usernameGenerated: boolean;
  legacyLoginEnabled: boolean;
};

export function canUseOriginalAccount(state: AccountLoginState) {
  return !state.usernameGenerated && (state.role === "super_admin" || state.legacyLoginEnabled);
}
