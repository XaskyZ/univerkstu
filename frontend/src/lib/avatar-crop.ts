export interface CropAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_MAX_SIZE = 512;
const DEFAULT_QUALITY = 0.85;
const AVATAR_ERRORS = {
  read: 'avatar_read_failed',
  load: 'avatar_load_failed',
  canvas: 'avatar_canvas_failed',
  export: 'avatar_export_failed',
} as const;

export function loadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (!result) {
        reject(new Error(AVATAR_ERRORS.read));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error(AVATAR_ERRORS.read));
    reader.readAsDataURL(file);
  });
}

function createHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(AVATAR_ERRORS.load));
    image.src = dataUrl;
  });
}

export async function getCroppedAvatar(
  dataUrl: string,
  croppedAreaPixels: CropAreaPixels,
  opts?: { maxSize?: number; quality?: number }
): Promise<string> {
  const image = await createHtmlImage(dataUrl);
  const maxSize = opts?.maxSize ?? DEFAULT_MAX_SIZE;
  const quality = opts?.quality ?? DEFAULT_QUALITY;

  const outputSize = Math.min(maxSize, Math.max(1, Math.round(Math.max(croppedAreaPixels.width, croppedAreaPixels.height))));
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(AVATAR_ERRORS.canvas);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    outputSize,
    outputSize
  );

  const jpeg = canvas.toDataURL('image/jpeg', quality);
  if (!jpeg.startsWith('data:image/jpeg')) {
    throw new Error(AVATAR_ERRORS.export);
  }
  return jpeg;
}
