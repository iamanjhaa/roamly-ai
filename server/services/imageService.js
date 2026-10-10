const sharp = require('sharp');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 1280;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

class ImageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = 'INVALID_IMAGE';
    this.statusCode = 400;
  }
}

function readImageDataUrl(image) {
  if (typeof image !== 'string') {
    throw new ImageValidationError('Choose a JPEG, PNG, or WebP image to analyze.');
  }

  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1].toLowerCase()) || match[2].length % 4 !== 0) {
    throw new ImageValidationError('The selected file is not a valid JPEG, PNG, or WebP image.');
  }
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new ImageValidationError('Images must be 12 MB or smaller.');
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('Images must be 12 MB or smaller and contain image data.');
  }
  return { buffer, declaredType: match[1].toLowerCase() };
}

async function prepareDiscoveryImage(image) {
  const { buffer, declaredType } = readImageDataUrl(image);
  let imageProcessor;
  try {
    imageProcessor = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await imageProcessor.metadata();
    const actualType = metadata.format === 'jpg' ? 'image/jpeg' : `image/${metadata.format}`;
    if (!SUPPORTED_IMAGE_TYPES.has(actualType) || actualType !== declaredType) {
      throw new ImageValidationError('The image contents do not match the selected JPEG, PNG, or WebP file type.');
    }
    if (!metadata.width || !metadata.height) {
      throw new ImageValidationError('The selected image has no readable dimensions.');
    }

    const processed = await imageProcessor
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    const processedMetadata = await sharp(processed).metadata();
    console.info('[IMAGE] discovery image prepared', {
      format: 'jpeg',
      width: processedMetadata.width,
      height: processedMetadata.height,
      bytes: processed.length,
    });
    return `data:image/jpeg;base64,${processed.toString('base64')}`;
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    if (error?.message?.toLowerCase().includes('pixel limit')) {
      throw new ImageValidationError('This image has too many pixels to process safely. Choose a smaller image.');
    }
    throw new ImageValidationError('The selected image could not be decoded. Try a different JPEG, PNG, or WebP image.');
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  ImageValidationError,
  prepareDiscoveryImage,
};
