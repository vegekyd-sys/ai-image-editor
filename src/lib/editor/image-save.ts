import { checkMediaDownload, prepareDownloadAsset, savePreparedDownload, type DownloadAssetParams, type PreparedDownloadCache } from './download';
import { exportImageDownload, IMAGE_SHARE_LONG_EDGE, inspectImageExport, type ImageExportInfo } from './image-export';
import { watermarkImage } from './web-watermark';

/** Small originals have no smaller size to choose. Save them without another screen. */
export async function trySaveSmallImage(params: DownloadAssetParams, cache: PreparedDownloadCache, watermarkRequired: boolean): Promise<boolean> {
  params.setIsSaving(true);
  try {
    const original = await prepareDownloadAsset(params, cache);
    if (original.kind !== 'image') return false;
    let info: ImageExportInfo | null = null;
    try { info = await inspectImageExport(original.blob); }
    catch { /* An unavailable decoder must not prevent saving the original file. */ }
    if (info && Math.max(info.width, info.height) > IMAGE_SHARE_LONG_EDGE) return false;

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
