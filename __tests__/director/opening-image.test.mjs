import test from 'node:test';
import assert from 'node:assert/strict';
import {stageOpeningImage} from '../../services/director/opening-image.mjs';

const base = 'https://cdn.makaron.app/storage/v1/object/public/images/';
const boardOrigin = 'https://board.example';
test('stages the same bytes from approved sources and bypasses other references', async () => {
  const bytes = Buffer.from([0xff,0xd8,0xff,0xd9]);
  const fetcher = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response(bytes, {headers:{'content-type':'image/jpeg'}});
  };
  const upload = async blob => {
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.equal(blob.type, 'image/jpeg');
    return 'staged';
  };
  for (const url of [base+'image.jpg', boardOrigin+'/voice/board-shared/'+'a'.repeat(32)+'.jpg']) {
    assert.equal(await stageOpeningImage(url,{boardOrigin,fetcher,upload}), 'staged');
  }
  for (const url of ['https://external.example/img.jpg',boardOrigin+'/voice/private',base+'../private/name']) {
    assert.equal(await stageOpeningImage(url,{boardOrigin,fetcher:assert.fail,upload:assert.fail}), null);
  }
});
test('skips invalid or oversized sources before staging',async () => {
  for (const headers of [{'content-type':'text/html'},{'content-type':'image/png','content-length':'9000000'}]) {
    assert.equal(await stageOpeningImage(base+'test',{fetcher:async()=>new Response('test',{headers}),upload:assert.fail}),null);
  }
});
