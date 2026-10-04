type Call = {
  provider: string | null;
  call_status: string;
  error_category: string | null;
  created_at: string;
};

export function recentProviderNotice(calls: Call[]) {
  const latest = [...calls].filter(call => call.provider === "openai" &&
    (call.call_status === "succeeded" || call.call_status === "failed"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest || latest.call_status === "succeeded") return null;
  if (latest.error_category === "quota") return {
    title: "AI account needs attention",
    message: "The latest AI request was blocked by API credits or an account limit. Check OpenAI API billing and limits, then retry the saved assessment. Render hosting charges are separate.",
    observed_at: latest.created_at
  };
  if (latest.error_category === "rate_limit") return {
    title: "AI request could not complete",
    message: "A recent request was reported as rate-limited. If it persists, check the API account and limits. Older records may not distinguish exhausted credits from temporary traffic limits.",
    observed_at: latest.created_at
  };
  return null;
}
