import type { LlmUsageGuardBlockedReason } from "@/lib/llm/usage/usage-guard";

export function buildLlmUnavailableStudentMessage(reason?: LlmUsageGuardBlockedReason | string) {
  void reason;

  return "The system is not able to generate the next AI-supported step right now. Your progress has been saved.";
}
