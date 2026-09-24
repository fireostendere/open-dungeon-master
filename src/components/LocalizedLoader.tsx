"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function LocalizedLoader({ className }: { className: string }) {
  const { t } = useI18n();
  return <Loader2 className={className} aria-label={t("common.loading")} />;
}
