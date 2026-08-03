'use client';

import { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { getCroppedAvatar } from '@/lib/avatar-crop';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';

interface AvatarCropModalProps {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

export function AvatarCropModal({ open, imageSrc, onCancel, onConfirm }: AvatarCropModalProps) {
  const { messages } = useLanguage();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleCancel = () => {
    if (processing) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    onCancel();
  };

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels || processing) return;

    setProcessing(true);
    try {
      const cropped = await getCroppedAvatar(imageSrc, croppedAreaPixels, {
        maxSize: 512,
        quality: 0.85,
      });
      onConfirm(cropped);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    } catch {
      toast.error(messages.profile.cropProcessFailed);
    } finally {
      setProcessing(false);
    }
  };

  if (!open || !imageSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="card w-full max-w-md p-4">
        <h3 className="text-lg font-semibold mb-3 text-fg">
          {messages.profile.cropTitle}
        </h3>

        <div className="relative w-full aspect-square rounded-xl overflow-hidden" style={{ background: 'var(--surface)' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="mt-4">
          <label className="text-sm block mb-2 text-secondary-fg">
            {messages.profile.cropZoom}
          </label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full"
            disabled={processing}
          />
        </div>

        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="btn"
            disabled={processing}
          >
            {messages.profile.cropCancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-primary"
            disabled={!croppedAreaPixels || processing}
          >
            {processing ? messages.profile.cropSaving : messages.profile.cropSave}
          </button>
        </div>
      </div>
    </div>
  );
}
