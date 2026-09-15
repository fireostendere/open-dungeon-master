"use client";

import { useEffect } from "react";
import generatedEnglish from "./generated/en.json";
import generatedRussian from "./generated/ru.json";
import { parseI18nMarker, type I18nParams } from "./marker";
import { useI18n } from "./context";

type MarkerRecord = { key: string; params?: I18nParams };
type Catalog = Record<string, string>;

const en = generatedEnglish as Catalog;
const ru = generatedRussian as Catalog;
const textRecords = new Map<Text, MarkerRecord>();
const attributeRecords = new Map<Element, Map<string, MarkerRecord>>();

function interpolate(text: string, params?: I18nParams): string {
  if (!params) return text;
  let result = text;
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, value == null ? "" : String(value));
  }
  return result;
}

function resolve(record: MarkerRecord, locale: "ru" | "en"): string {
  const source = (locale === "ru" ? ru[record.key] : undefined) ?? en[record.key] ?? record.key;
  return interpolate(source, record.params);
}

function skipTextNode(node: Text): boolean {
  const tag = node.parentElement?.tagName;
  return tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT";
}

export function I18nMarkerBoundary() {
  const { locale } = useI18n();

  useEffect(() => {
    const applyText = (node: Text) => {
      if (skipTextNode(node)) return;
      const marker = parseI18nMarker(node.data);
      if (marker) {
        textRecords.set(node, marker);
        const translated = resolve(marker, locale);
        if (node.data !== translated) node.data = translated;
        return;
      }
      const previous = textRecords.get(node);
      if (!previous) return;
      const translated = resolve(previous, locale);
      if (node.data === translated) return;
      textRecords.delete(node);
    };

    const applyElement = (element: Element) => {
      let records = attributeRecords.get(element);
      for (const attribute of Array.from(element.attributes)) {
        const marker = parseI18nMarker(attribute.value);
        if (marker) {
          if (!records) {
            records = new Map<string, MarkerRecord>();
            attributeRecords.set(element, records);
          }
          records.set(attribute.name, marker);
          const translated = resolve(marker, locale);
          if (attribute.value !== translated) element.setAttribute(attribute.name, translated);
          continue;
        }
        const previous = records?.get(attribute.name);
        if (!previous) continue;
        const translated = resolve(previous, locale);
        if (attribute.value !== translated) records?.delete(attribute.name);
      }
      if (records && records.size === 0) attributeRecords.delete(element);
    };

    const scan = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        applyText(root as Text);
        return;
      }
      if (root.nodeType === Node.ELEMENT_NODE) applyElement(root as Element);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) applyText(current as Text);
        else applyElement(current as Element);
        current = walker.nextNode();
      }
    };

    for (const [node, record] of Array.from(textRecords.entries())) {
      if (!node.isConnected) {
        textRecords.delete(node);
        continue;
      }
      const translated = resolve(record, locale);
      if (node.data !== translated) node.data = translated;
    }
    for (const [element, records] of Array.from(attributeRecords.entries())) {
      if (!element.isConnected) {
        attributeRecords.delete(element);
        continue;
      }
      for (const [name, record] of records) {
        const translated = resolve(record, locale);
        if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
      }
    }

    scan(document.documentElement);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          applyText(mutation.target as Text);
        } else if (mutation.type === "attributes") {
          applyElement(mutation.target as Element);
        } else {
          for (const added of Array.from(mutation.addedNodes)) scan(added);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
