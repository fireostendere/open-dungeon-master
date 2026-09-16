import { installedTracks } from "@/lib/ambience/library";
import { cueById } from "@/lib/ambience/catalog";
import { listDocuments } from "@/lib/content";
import { contentPackInstalled } from "@/lib/content/db";
import { listWorldPackSummaries } from "@/lib/worlds";
import LicensesContent from "./LicensesContent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Licenses | Open Dungeon Master" };

export default function LicensesPage() {
  const ambience = installedTracks().map((track) => ({ ...track, label: cueById(track.cueId)?.label }));
  return <LicensesContent documents={listDocuments()} installed={contentPackInstalled()} worldPacks={listWorldPackSummaries()} ambience={ambience} />;
}
