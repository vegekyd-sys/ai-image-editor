export function normalizeAgentErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown agent error';
    }
  }
  return String(error);
}
