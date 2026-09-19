/** One correction opportunity per repeated local constraint, not four paid
 * model turns rewriting the same invalid request. Never retries the provider. */
export function createVideoValidationReporter() {
  const failures = new Map<string, number>();
  return (model: string | undefined, message: string, details?: Record<string, unknown>) => {
    const key = `${model ?? 'auto'}:${message}`;
    const attempts = (failures.get(key) ?? 0) + 1;
    failures.set(key, attempts);
    const terminal = attempts >= 2;
    return {
      success: false as const,
      terminal,
      retryable: !terminal,
      errorCode: terminal ? 'video_repeated_validation' : 'video_invalid_request',
      message: terminal
        ? `${message} The same constraint failed twice. Stop submitting; explain the incompatible inputs. Do not switch the user's source image or model to bypass this error.`
        : message,
      validation: { model, attempts, ...details },
      ...(terminal ? { userMessage: {
        zh: '视频参数修正后仍未通过校验，已停止重复提交；所选图片和模型未被替换。',
        'zh-Hant': '影片參數修正後仍未通過驗證，已停止重複提交；所選圖片和模型未被替換。',
        en: 'Video parameters still failed validation after a correction. Repeated submissions stopped; the selected image and model were not replaced.',
        ja: '修正後も動画パラメータの検証に失敗したため、再送信を停止しました。選択した画像とモデルは変更していません。',
      } } : {}),
    };
  };
}
