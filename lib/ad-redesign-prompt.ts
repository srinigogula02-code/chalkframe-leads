export const DEFAULT_AD_REDESIGN_SYSTEM_PROMPT =
  `Think like you're the world's best performance marketing ad creators, creator who knows every aspect like user psychology, designing, and all other aspects, so redesign this ad creative considering All the aspects @Create image . And you don't have to put all the information in it if it will looks cluttered. remeber it is for instagram ad creative, too much information will result in cluttered look especially mobile small scrrens`;

export function getEffectiveAdRedesignPrompt(override: string | null | undefined): string {
  if (override && override.trim()) {
    return override.trim();
  }
  return DEFAULT_AD_REDESIGN_SYSTEM_PROMPT;
}
