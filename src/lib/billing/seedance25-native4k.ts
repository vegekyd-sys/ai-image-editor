import type { MediaQuote } from './media-pricing'

/** A quote is informational: no reservation and no provider submission occurred. */
export function native4kQuoteResult(quote: MediaQuote) {
  return {
    success: false as const,
    errorCode: 'NATIVE_4K_COST_DISCLOSURE_REQUIRED',
    submissionUncertain: false,
    costQuote: {
      credits: quote.credits,
      durationSec: quote.durationSec,
      imageCount: quote.imageCount,
      referenceVideoDurationSec: quote.referenceVideoDurationSec,
    },
    message: `High-cost Seedance 2.5 native 4K: estimated total ${quote.credits} Makaron credits. Output ${quote.durationSec}s, video input ${quote.referenceVideoDurationSec}s. No credits reserved and no video submitted. Show this total to the user before proceeding. Only proceed for an explicit native 4K request or explicit model/resolution selection; do not ask again if that request already authorizes generation. Submit the same request with max_credits (Agent) / maxCredits (MCP) set to this total after disclosure. Never use this route for ordinary/HD requests or failure recovery. Supplier credits are not Makaron credits.`,
    userMessage: {
      en: `Native 4K is expensive. Estimated total: ${quote.credits} Makaron credits (${quote.durationSec}s output, ${quote.referenceVideoDurationSec}s video input). Nothing has been charged or submitted.`,
      zh: `原生 4K 费用较高。预计总费用：${quote.credits} Makaron 积分（输出 ${quote.durationSec} 秒，视频输入 ${quote.referenceVideoDurationSec} 秒）。尚未扣费或提交生成。`,
      'zh-Hant': `原生 4K 費用較高。預計總費用：${quote.credits} Makaron 積分（輸出 ${quote.durationSec} 秒，影片輸入 ${quote.referenceVideoDurationSec} 秒）。尚未扣費或提交生成。`,
      ja: `ネイティブ 4K は高額です。合計見積もり：${quote.credits} Makaron クレジット（出力 ${quote.durationSec} 秒、動画入力 ${quote.referenceVideoDurationSec} 秒）。課金・生成送信はまだ行っていません。`,
    },
  }
}

export function native4kNeedsDisclosure(quote: MediaQuote, maxCredits?: number): boolean {
  return !Number.isSafeInteger(maxCredits) || maxCredits! < quote.credits
}
