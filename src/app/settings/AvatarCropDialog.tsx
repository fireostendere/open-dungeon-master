"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Upload, X, ZoomIn } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// The familiar profile-picture flow: pick a file, pan/zoom a square crop,
// export 512x512, upload through the existing /api/upload route.

export type UploadedImage = {
  id: string;
  name: string;
  type: string;
  url: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function cropToSquare(imageSrc: string, area: Area): Promise<{ dataUrl: string; type: string }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not read the image."));
    element.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable.");
  }
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  const webp = canvas.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp")
    ? { dataUrl: webp, type: "image/webp" }
    : { dataUrl: canvas.toDataURL("image/jpeg", 0.9), type: "image/jpeg" };
}

export function AvatarCropDialog({
  title,
  onUploaded,
  onClose,
}: {
  title: string;
  onUploaded: (image: UploadedImage) => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const copy = localeText(locale, {
    en: {
      invalidType: "Only PNG, JPEG, and WebP images are supported.",
      tooLarge: "Image is larger than 8MB.",
      uploadFailed: "Upload failed.",
      processFailed: "Could not process the image.",
      choose: "Choose an image",
      different: "Different image",
    },
    ru: {
      invalidType: "Поддерживаются только изображения PNG, JPEG и WebP.",
      tooLarge: "Размер изображения превышает 8 МБ.",
      uploadFailed: "Не удалось загрузить изображение.",
      processFailed: "Не удалось обработать изображение.",
      choose: "Выбрать изображение",
      different: "Другое изображение",
    },
    pl: {
      invalidType: "Obsługiwane są tylko obrazy PNG, JPEG i WebP.",
      tooLarge: "Obraz ma więcej niż 8 MB.",
      uploadFailed: "Nie udało się przesłać obrazu.",
      processFailed: "Nie udało się przetworzyć obrazu.",
      choose: "Wybierz obraz",
      different: "Inny obraz",
    },
  });
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_area: Area, croppedAreaPixels: Area) => {
    setAreaPixels(croppedAreaPixels);
  }, []);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError(copy.invalidType);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(copy.tooLarge);
      return;
    }
    setError("");
    setFileName(file.name);
    setSource(await fileToDataUrl(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  async function save() {
    if (!source || !areaPixels) return;
    setBusy(true);
    setError("");
    try {
      const { dataUrl, type } = await cropToSquare(source, areaPixels);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: fileName || "avatar", type }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.uploadFailed);
        return;
      }
      onUploaded(data as UploadedImage);
      onClose();
    } catch {
      setError(copy.processFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(ui.dialog, "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto")}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg tracking-wide text-amber-50">{title}</Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300" aria-label={t("common.close")}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />

          {source ? (
            <>
              <div className="relative h-64 w-full overflow-hidden rounded-lg bg-stone-950">
                <Cropper
                  image={source}
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
              <div className="mt-3 flex items-center gap-2">
                <ZoomIn className="size-4 text-stone-500" />
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.05}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="flex-1 accent-amber-600"
                />
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-700 text-sm text-stone-400 hover:border-amber-800 hover:text-stone-200"
            >
              <Upload className="size-5" />
              {copy.choose}
            </button>
          )}

          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

          <div className="mt-4 flex justify-between gap-2">
            {source ? (
              <button type="button" onClick={() => fileInput.current?.click()} className={ui.btnSmall}>
                {copy.different}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={ui.btnSmall}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={save} disabled={busy || !source} className={ui.btnPrimary}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} {t("common.save")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
