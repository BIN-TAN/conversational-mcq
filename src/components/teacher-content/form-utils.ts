"use client";

import type { ItemOption } from "./types";

export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text || "{}") as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function arrayToLines(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.filter((entry) => typeof entry === "string").join("\n");
}

export function normalizeOptions(value: unknown): ItemOption[] {
  if (!Array.isArray(value)) {
    return [
      { label: "A", text: "" },
      { label: "B", text: "" },
      { label: "C", text: "" }
    ];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      return {
        label: String(record.label ?? ""),
        text: String(record.text ?? "")
      };
    })
    .filter((entry): entry is ItemOption => Boolean(entry));
}

export function normalizeRationales(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      typeof entry === "string" ? entry : String(entry ?? "")
    ])
  );
}
