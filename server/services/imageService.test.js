const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  prepareDiscoveryImage,
} = require('./imageService');

async function dataUrl(format, options = {}) {
  const image = await sharp({
    create: {
      width: options.width || 64,
      height: options.height || 48,
      channels: 3,
      background: { r: 32, g: 128, b: 64 },
    },
  }).toFormat(format).toBuffer();
  const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
  return `data:${mimeType};base64,${image.toString('base64')}`;
}

test('prepares JPEG, PNG, and WebP uploads as valid resized JPEGs', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const input = await dataUrl(format);
    const output = await prepareDiscoveryImage(input);
    const outputBuffer = Buffer.from(output.split(',')[1], 'base64');
    const metadata = await sharp(outputBuffer).metadata();

    assert.match(output, /^data:image\/jpeg;base64,/);
    assert.equal(metadata.format, 'jpeg');
    assert.deepEqual([metadata.width, metadata.height], [64, 48]);
  }
});

test('resizes large phone images to the model analysis dimensions', async () => {
  const output = await prepareDiscoveryImage(await dataUrl('jpeg', { width: 4000, height: 3000 }));
  const metadata = await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata();

  assert.ok(metadata.width <= MAX_IMAGE_DIMENSION);
  assert.ok(metadata.height <= MAX_IMAGE_DIMENSION);
});

test('rejects invalid types, mismatched data, malformed base64, and oversized uploads', async () => {
  await assert.rejects(prepareDiscoveryImage('data:image/gif;base64,R0lGODlh'), /valid JPEG, PNG, or WebP/);
  const mislabeledJpeg = (await dataUrl('jpeg')).replace('data:image/jpeg', 'data:image/png');
  await assert.rejects(prepareDiscoveryImage(mislabeledJpeg), /do not match/);
  await assert.rejects(prepareDiscoveryImage('data:image/jpeg;base64,not-base64!'), /valid JPEG, PNG, or WebP/);
  const oversized = `data:image/jpeg;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')}`;
  await assert.rejects(prepareDiscoveryImage(oversized), /12 MB or smaller/);
});
