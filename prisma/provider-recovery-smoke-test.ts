import assert from "node:assert/strict";
import { APIError } from "openai";
import { z } from "zod";
import { sanitizeUnknownError } from "../src/lib/llm/errors";
import { normalizeOpenAITransportError } from "../src/lib/llm/openai-transport-diagnostics";
import { isOpenAIQuotaError, parseProviderRetryAfter, providerFailureAudit, providerRetryDelayMs } from "../src/lib/llm/provider-recovery";
import { recentProviderNotice } from "../src/lib/llm/provider-status";
import { classifyProviderFailure, executeWithBoundedProviderTransportRetry } from "../src/lib/llm/provider-transport-retry";
import type { LlmProvider, OpenAITransportTelemetry, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";

const milestones = { transport_adapter_entered:true, request_serialization_completed:true, fetch_invoked:true,
  response_headers_received:true, response_body_started:true, response_body_completed:true,
  response_body_bytes_received:150, response_body_received:false };
function failed(code: string, type: string, headers = new Headers()): StructuredAgentResult<{ok:boolean}> {
  const error = APIError.generate(429, { error: { code, type, message:'Synthetic failure' } }, 'Synthetic failure', headers);
  const normalized = normalizeOpenAITransportError(error, milestones);
  const telemetry: OpenAITransportTelemetry = { ...milestones, provider:'openai', transport:'openai_responses',
    adapter_version:'synthetic',client_request_id:'synthetic',model_name:'synthetic',base_url_host:'api.openai.com',
    base_url_approved:true,http_status:429,retry_after_ms:normalized.retry_after_ms,normalized_error:normalized };
  return {provider:'openai',client_request_id:'synthetic',status:'failed',latency_ms:1,
    error:sanitizeUnknownError(error),transport_telemetry:telemetry};
}
const request: StructuredAgentRequest<{synthetic:boolean},{ok:boolean}> = {
  agent_name:'connectivity_test',model_config:{model_name:'synthetic'},instructions:'Synthetic fixture',
  input:{synthetic:true},output_schema:z.object({ok:z.boolean()}),schema_name:'test',client_request_id:'test',timeout_ms:1000
};
async function run(result: StructuredAgentResult<{ok:boolean}>) {
  let calls = 0;
  const delays: number[] = [];
  const provider: LlmProvider = { async executeStructured<TInput,TOutput>(received: StructuredAgentRequest<TInput,TOutput>) {
    assert.equal(received.instructions, request.instructions);
    calls++;
    return (calls === 1 ? result : {provider:'openai',client_request_id:'test',status:'completed',parsed_output:{ok:true},latency_ms:1}) as StructuredAgentResult<TOutput>;
  }};
  const execution = await executeWithBoundedProviderTransportRetry({provider,request,logical_call_id:'synthetic',source_binding_hash:'synthetic',random:()=>0.5,sleep:async ms=>{delays.push(ms);}});
  return {calls,delays,execution};
}
async function main() {
  let checks = 0;
  for (const code of ['credit_balance_exhausted','insufficient_quota','billing_hard_limit_reached',
    'organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','new_quota_code']) {
    const result = failed(code,'insufficient_quota',new Headers({'retry-after':'1'}));
    assert.equal(result.error?.category,'quota');
    assert.equal(result.error?.retryable,false);
    assert.equal(result.transport_telemetry?.normalized_error?.typed_failure_reason,'openai_quota_exceeded');
    assert.equal(classifyProviderFailure(result).category,'quota_exceeded_nonretryable');
    assert.equal((await run(result)).calls,1);
    checks += 5;
  }
  assert(isOpenAIQuotaError({code:'credit_balance_exhausted'}));
  assert(isOpenAIQuotaError({error:{type:'insufficient_quota'}}));
  assert(!isOpenAIQuotaError({code:'rate_limit_exceeded',type:'rate_limit_error'}));
  const now = Date.parse('2026-10-04T03:00:00Z');
  for (const [value,expected] of [['4.5',4500],['Sun, 04 Oct 2026 03:00:10 GMT',10000],['-1',null],['no',null],['Infinity',null]] as const) {
    assert.equal(parseProviderRetryAfter(new Headers({'retry-after':value}),now),expected); checks++;
  }
  assert.equal(parseProviderRetryAfter(new Headers({'retry-after-ms':'1250','retry-after':'5'})),1250);
  const temporary = failed('rate_limit_exceeded','rate_limit_error');
  const recovered = await run(temporary);
  assert.equal(recovered.calls,2);
  assert.deepEqual(recovered.delays,[2250]);
  assert.equal(recovered.execution.status,'accepted');
  assert.equal(recovered.execution.attempt_traces[0].classification?.domain,'provider_infrastructure_transport');
  const slow = await run(failed('slow_down','rate_limit_error',new Headers({'retry-after':'12'})));
  assert.deepEqual(slow.delays,[12250]);
  const deferred = await run(failed('slow_down','rate_limit_error',new Headers({'retry-after':'61'})));
  assert.equal(deferred.calls,1);
  assert.deepEqual(deferred.delays,[]);
  assert.equal(deferred.execution.attempt_traces[0].retry_reason,'server_delay_exceeds_inline_retry_budget');
  assert.equal(providerRetryDelayMs(temporary,8000,()=>1),8500);
  const quota = failed('credit_balance_exhausted','insufficient_quota');
  quota.transport_telemetry!.normalized_error!.sanitized_message = 'Secret request contents must not be persisted here';
  const audit = providerFailureAudit(quota)!;
  assert.equal(audit.provider_error_code,'credit_balance_exhausted');
  assert(!JSON.stringify(audit).includes('Secret'));
  const call = {provider:'openai',call_status:'failed',error_category:'quota',created_at:'2026-10-04T03:00:00Z'};
  assert.equal(recentProviderNotice([call])?.title,'AI account needs attention');
  assert.equal(recentProviderNotice([call,{...call,call_status:'succeeded',created_at:'2026-10-04T03:01:00Z'}]),null);
  assert(recentProviderNotice([call,{...call,provider:'mock',call_status:'succeeded',created_at:'2026-10-04T03:01:00Z'}]));
  checks += 19;
  console.log(JSON.stringify({status:'passed',checks,provider_calls:0,network_requests:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
