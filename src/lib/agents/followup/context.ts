import { getServerEnv } from "@/lib/env";

export type FollowupContextConfig = {
  max_turns: number;
  message_max_chars: number;
  context_max_chars: number;
  substantive_turns_before_update: number;
};

export function getFollowupContextConfig(): FollowupContextConfig {
  const env = getServerEnv();

  return {
    max_turns: env.FOLLOWUP_CONTEXT_MAX_TURNS,
    message_max_chars: env.FOLLOWUP_MESSAGE_MAX_CHARS,
    context_max_chars: env.FOLLOWUP_CONTEXT_MAX_CHARS,
    substantive_turns_before_update: env.FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE
  };
}

export function truncateForFollowupProvider(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 28))}\n[truncated for provider context]`;
}

export function isPromptInjectionLike(value: string) {
  const normalized = value.toLowerCase();
  const patterns = [
    /ignore (all )?(previous|prior|system) instructions/,
    /reveal (the )?(system prompt|hidden instructions|developer message)/,
    /change (your|the) role/,
    /change (the )?formative plan/,
    /change (the )?assessment phase/,
    /show (teacher-only|hidden|backend) (metadata|rules)/,
    /show (unrelated )?answer keys?/,
    /alter (the )?(saved )?(profile|formative decision)/,
    /bypass (usage|safety|guard|limits)/,
    /access (environment variables|api keys?|database url)/,
    /invoke tools?/
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}
