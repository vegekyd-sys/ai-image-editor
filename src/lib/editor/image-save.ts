import { checkMediaDownload, prepareDownloadAsset, savePreparedDownload, type DownloadAssetParams, type PreparedDownloadCache } from './download';
import { exportImageDownload, inspectImageExport, type ImageExportInfo } from './image-export';
import { watermarkImage } from './web-watermark';

// Use pixel count, independently of the sharing export's long edge. A 1K panorama
// can be 2928 × 352 and should save as directly as a 1024 × 1024 image.
const DIRECT_SAVE_MAX_PIXELS = 2048 * 1024;

/** Ordinary images save directly; larger originals offer size and format choices. */
export async function trySaveSmallImage(params: DownloadAssetParams, cache: PreparedDownloadCache, watermarkRequired: boolean): Promise<boolean> {
  params.setIsSaving(true);
  try {
    const original = await prepareDownloadAsset(params, cache);
    if (original.kind !== 'image') return false;
    let info: ImageExportInfo | null = null;
    try { info = await inspectImageExport(original.blob); }
    catch { /* An unavailable decoder must not prevent saving the original file. */ }
    if (info && info.width * info.height > DIRECT_SAVE_MAX_PIXELS) return false;

    let selected = original;
    if (watermarkRequired && !(await checkMediaDownload())) {
      selected = { ...original, blob: await watermarkImage(original.blob), filename: original.filename.replace(/\.[^.]+$/, '.png') };
      if (info) selected = await exportImageDownload(selected, info, 'original', 'original');
    }
    await savePreparedDownload(selected);
    params.setAgentStatus(params.t('editor.done'));
    params.showSaveToast();
    return true;
  } finally { params.setIsSaving(false); }
}
