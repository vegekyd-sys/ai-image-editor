/** Keep recovery data in structured receipts, not in the conversational delivery. */
export function layerizeModelOutput(output: Record<string, unknown>, surface: 'app' | 'external' = 'external'): string {
  const completed = output.status === 'completed';
  const result = completed ? {
    success: output.success, status: output.status,
    ...(surface === 'external' ? { projectUrl: output.projectUrl } : {}),
  } : output;
  return JSON.stringify(result) + '\n' + (completed
    ? surface === 'app'
      ? 'The editable result is displayed in this Makaron page. Briefly confirm completion in the user language and invite layer editing. Do not include URLs, Markdown links, job IDs, workspace paths or technical details.'
      : 'Briefly confirm completion in the user language and include one Makaron edit link using projectUrl. Do not include job IDs, workspace paths or technical details.'
    : 'If pending, query get_layerize_status with the SAME jobId; never regenerate to recover a result.')
    + ' A completed result is already published and uses the latest saved edits. No further workspace read is needed to confirm completion. Do not call run_code or publish it again.';
}
