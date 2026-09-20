import type { AspectPreset, GeneratedImage } from "@/lib/types";

// Manual scene illustrations and maps keep the historical GeneratedImage
// record shape so existing clients and exports need no migration. The server
// does not create the image; it only records an uploaded file.
export function uploadedImageRecord(url: string, aspect: AspectPreset): GeneratedImage {
  return {
    id: crypto.randomUUID(),
    url,
    prompt: "",
    mode: "fast",
    aspect,
    width: 0,
    height: 0,
  };
}
