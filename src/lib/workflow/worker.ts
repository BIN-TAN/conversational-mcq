import { randomUUID } from "node:crypto";
import type { WorkflowJob } from "@prisma/client";
import { handleWorkflowJob } from "./handlers";
import {
  claimNextWorkflowJob,
  completeWorkflowJob,
  failOrRetryWorkflowJob,
  markSessionAutomationException
} from "./jobs";
import { getWorkflowJobConfig } from "./config";
import { markFollowupUpdateCycleFailedFromJob } from "@/lib/agents/followup-updates/service";
import { markConceptProgressionFailedFromJob } from "@/lib/services/concept-progression/progression";

export type ProcessWorkflowJobResult = {
  job_public_id: string;
  job_type: string;
  outcome: "completed" | "retryable" | "failed";
};

export async function processWorkflowJob(job: WorkflowJob): Promise<ProcessWorkflowJobResult> {
  try {
    const result = await handleWorkflowJob(job);

    if (result.outcome === "completed") {
      await completeWorkflowJob(job);

      return {
        job_public_id: job.job_public_id,
        job_type: job.job_type,
        outcome: "completed"
      };
    }

    const updated = await failOrRetryWorkflowJob({
      job,
      retryable: result.outcome === "retryable",
      error_category: result.error_category ?? result.outcome,
      error_message: result.error_message ?? "Workflow job did not complete."
    });

    if (!updated.retry_scheduled) {
      await markFollowupUpdateCycleFailedFromJob({
        job_payload: job.payload,
        job_type: job.job_type,
        error_category: result.error_category ?? "unknown",
        error_message: result.error_message ?? "Workflow job did not complete."
      });
      await markConceptProgressionFailedFromJob({
        job_payload: job.payload,
        error_category: result.error_category ?? "unknown",
        error_message: result.error_message ?? "Workflow job did not complete."
      });
      await markSessionAutomationException({
        assessment_session_db_id: job.assessment_session_db_id,
        reason: `automatic_workflow_failed:${job.job_type}:${result.error_category ?? "unknown"}`
      });
    }

    return {
      job_public_id: job.job_public_id,
      job_type: job.job_type,
      outcome: updated.retry_scheduled ? "retryable" : "failed"
    };
  } catch (error) {
    const updated = await failOrRetryWorkflowJob({
      job,
      retryable: true,
      error_category: "worker_exception",
      error_message: error instanceof Error ? error.message : "Workflow worker exception."
    });

    if (!updated.retry_scheduled) {
      await markFollowupUpdateCycleFailedFromJob({
        job_payload: job.payload,
        job_type: job.job_type,
        error_category: "worker_exception",
        error_message: error instanceof Error ? error.message : "Workflow worker exception."
      });
      await markConceptProgressionFailedFromJob({
        job_payload: job.payload,
        error_category: "worker_exception",
        error_message: error instanceof Error ? error.message : "Workflow worker exception."
      });
      await markSessionAutomationException({
        assessment_session_db_id: job.assessment_session_db_id,
        reason: `automatic_workflow_failed:${job.job_type}:worker_exception`
      });
    }

    return {
      job_public_id: job.job_public_id,
      job_type: job.job_type,
      outcome: updated.retry_scheduled ? "retryable" : "failed"
    };
  }
}

export async function drainAvailableWorkflowJobsOnce(input: { worker_id?: string } = {}) {
  const workerId = input.worker_id ?? `workflow-drain-${randomUUID()}`;
  const processed: ProcessWorkflowJobResult[] = [];

  while (true) {
    const job = await claimNextWorkflowJob(workerId);

    if (!job) {
      return processed;
    }

    processed.push(await processWorkflowJob(job));
  }
}

export async function runWorkflowWorker(input: { worker_id?: string; once?: boolean } = {}) {
  const workerId = input.worker_id ?? `workflow-worker-${randomUUID()}`;
  const config = getWorkflowJobConfig();
  let stopped = false;

  const stop = () => {
    stopped = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const processed = await drainAvailableWorkflowJobsOnce({ worker_id: workerId });

      if (input.once) {
        return processed;
      }

      if (processed.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.poll_interval_ms));
      }
    } while (!stopped);

    return [];
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
