import { getServerEnv } from "@/lib/env";

export function getWorkflowJobConfig() {
  const env = getServerEnv();

  return {
    max_attempts: env.WORKFLOW_JOB_MAX_ATTEMPTS,
    base_retry_ms: env.WORKFLOW_JOB_BASE_RETRY_MS,
    max_retry_ms: env.WORKFLOW_JOB_MAX_RETRY_MS,
    lease_timeout_ms: env.WORKFLOW_JOB_LEASE_TIMEOUT_MS,
    poll_interval_ms: env.WORKFLOW_JOB_POLL_INTERVAL_MS
  };
}

export function retryDelayMs(attemptCount: number) {
  const config = getWorkflowJobConfig();
  const exponent = Math.max(0, attemptCount - 1);
  const raw = config.base_retry_ms * 2 ** exponent;
  const jitter = 0.8 + Math.random() * 0.4;

  return Math.min(config.max_retry_ms, Math.round(raw * jitter));
}
