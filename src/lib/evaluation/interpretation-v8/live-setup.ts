/**
 * Settings for a live evaluation run, taken from files the researcher names on the command line:
 *
 * - --env-file <file>: the env file the researcher's earlier live runs used. Only the two
 *   variables that point the application at the existing OpenAI key are taken from it
 *   (OPENAI_API_KEY or OPENAI_API_KEY_FILE); nothing else in that file changes the run.
 * - --runtime-env <json>: the approved runtime settings file. Only model settings are taken
 *   from it (model, reasoning effort, output-token limit, timeout, retries).
 *
 * Nothing is searched for, printed or written: the values only enter this process's environment.
 */
import path from "node:path";
import { parseEnv } from "node:util";

const KEY_VARIABLES = ["OPENAI_API_KEY", "OPENAI_API_KEY_FILE"] as const;

/** The key variables from an env file's text; a relative key-file path is relative to that file. */
export function keyVariablesFromEnvFile(text: string, envFilePath: string) {
  const parsed = parseEnv(text.replace(/^﻿/, ""));
  const variables: Record<string, string> = {};
  for (const name of KEY_VARIABLES) {
    const value = parsed[name]?.trim();
    if (value) variables[name] = name === "OPENAI_API_KEY_FILE" ? path.resolve(path.dirname(envFilePath), value) : value;
  }
  return variables;
}

/** Model settings only: which model, reasoning effort, output-token limit, timeout and retries. */
export const MODEL_SETTING = /^OPENAI_(?:MODEL_|REASONING_EFFORT_|MAX_OUTPUT_TOKENS_)[A-Z0-9_]+$|^OPENAI_(?:REQUEST_TIMEOUT_MS|MAX_RETRIES)$/;

export function modelSettingsFromRuntimeEnv(runtime: Record<string, unknown>) {
  const settings: Record<string, string> = {};
  for (const [name, value] of Object.entries(runtime)) {
    if (MODEL_SETTING.test(name) && (typeof value === "string" || typeof value === "number") && String(value).trim()) {
      settings[name] = String(value).trim();
    }
  }
  return settings;
}
