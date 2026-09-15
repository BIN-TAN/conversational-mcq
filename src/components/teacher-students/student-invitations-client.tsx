"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { ArrowLeft, Check, Eye, Loader2, Mail, Send, Unplug, Upload, X } from "lucide-react";
import { DEFAULT_INVITATION_BODY, DEFAULT_INVITATION_SUBJECT, INVITATION_FIELDS, MAX_CREDENTIAL_CSV_BYTES,
  type InvitationConfig, type InvitationPreviewResult, type InvitationTemplate } from "@/lib/services/student-invitations/contracts";

type GoogleOAuth = { accounts: { oauth2: { initCodeClient: (options: { client_id: string; scope: string; ux_mode: "popup";
  select_account: boolean; hint?: string; callback: (response: { code?: string; error?: string }) => void;
  error_callback: () => void }) => { requestCode: () => void } } } };
const root = "/api/teacher/students/invitations";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50";
const primary = `${button} !border-accent !bg-accent !text-white`;
const inputClass = "min-h-10 w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 text-sm";
class InvitationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`${root}${path}`, { method: body === undefined ? "GET" : method, cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json", "X-Invitation-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new InvitationRequestError(result.error?.message ?? "The request could not complete.", response.status);
  return result as T;
}
const statusText: Record<string, string> = { ready: "Ready", sent: "Sent", sending: "Sending", failed: "Not sent", unknown: "Check Gmail Sent" };

export function StudentInvitationsClient({ initialStudentIds }: { initialStudentIds: string[] }) {
  const [config, setConfig] = useState<InvitationConfig | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [gmailReady, setGmailReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [template, setTemplate] = useState<InvitationTemplate>({ sender_email: "", instructor_name: "",
    subject: DEFAULT_INVITATION_SUBJECT, body: DEFAULT_INVITATION_BODY });
  const [preview, setPreview] = useState<InvitationPreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [approved, setApproved] = useState(false);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const cancel = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await request<InvitationConfig>(""); setConfig(data);
      setTemplate(current => ({ ...current, sender_email: current.sender_email || data.gmail_email || data.default_email,
        instructor_name: current.instructor_name || data.instructor_name }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load invitation settings."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { cancel.current = true; }; }, [load]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (csv || sending) { event.preventDefault(); }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [csv, sending]);
  function invalidate() { setPreview(null); setSelected(new Set()); setApproved(false); setNotice(""); setShowPassword(false); }
  function edit<K extends keyof InvitationTemplate>(key: K, value: InvitationTemplate[K]) {
    invalidate(); setTemplate(current => ({ ...current, [key]: value }));
  }
  async function upload(chosen?: File) {
    if (!chosen) return;
    invalidate(); setError(""); setCsv(""); setFilename("");
    try {
      if (!chosen.name.toLowerCase().endsWith(".csv") || chosen.size > MAX_CREDENTIAL_CSV_BYTES) throw new Error("Choose a credential CSV no larger than 256 KB.");
      setCsv(await chosen.text()); setFilename(chosen.name);
    } catch (e) { setError(e instanceof Error ? e.message : "The file could not be read."); }
  }
  async function prepare() {
    setWorking(true); setError(""); setNotice(""); setApproved(false); setShowPassword(false);
    try {
      const result = await request<InvitationPreviewResult>("/preview", { csv_text: csv, template });
      setPreview(result);
      const ids = result.invitations.filter(row => ["ready", "failed"].includes(row.status) &&
        (!initialStudentIds.length || initialStudentIds.includes(row.user_id))).map(row => row.user_id);
      setSelected(new Set(ids)); setActive(ids[0] || result.invitations[0]?.user_id || "");
      if (!result.invitations.length) setNotice("No matching pending accounts. Review the excluded rows below.");
    } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "Could not prepare emails."); }
    finally { setWorking(false); }
  }
  function connect() {
    const google = (window as Window & { google?: GoogleOAuth }).google;
    if (!google || !config?.gmail_client_id) return;
    setError(""); setConnecting(true); setApproved(false);
    google.accounts.oauth2.initCodeClient({ client_id: config.gmail_client_id,
      scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
      ux_mode: "popup", select_account: true, hint: template.sender_email || undefined,
      error_callback: () => { setConnecting(false); setError("Gmail connection was cancelled or its popup was blocked."); },
      callback: response => {
        if (!response.code || response.error) { setConnecting(false); setError("Gmail permission was not granted."); return; }
        void request<{ email: string }>("/gmail", { code: response.code }).then(result => {
          setConfig(current => current ? { ...current, gmail_email: result.email } : current);
          edit("sender_email", result.email); setNotice(`Connected to ${result.email}. No emails have been sent.`);
        }).catch(e => setError(e instanceof Error ? e.message : "Gmail connection failed.")).finally(() => setConnecting(false));
      }
    }).requestCode();
  }
  async function disconnect() {
    setConnecting(true); setError(""); setApproved(false);
    try { await request("/gmail", {}, "DELETE"); setConfig(current => current ? { ...current, gmail_email: null } : current); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect Gmail."); }
    finally { setConnecting(false); }
  }
  async function send() {
    if (!approved || !preview || !config?.gmail_email || sending) return;
    const batch = preview.invitations.filter(row => selected.has(row.user_id) && ["ready", "failed"].includes(row.status));
    cancel.current = false; setSending(true); setError(""); setNotice(""); setApproved(false); setShowPassword(false);
    let sent = 0;
    for (const row of batch) {
      if (cancel.current) break;
      const update = (status: string) => setPreview(current => current ? { ...current, invitations: current.invitations.map(item =>
        item.user_id === row.user_id ? { ...item, status: status as typeof item.status } : item) } : current);
      update("sending");
      try {
        const result = await request<{ status: string; failure_code?: string }>("/send", { ticket: row.ticket, message: row.message, confirmed: true });
        update(result.status);
        if (result.status === "sent") sent++;
        else {
          setError(result.status === "failed" ? "Gmail rejected an email. Sending stopped. Refresh the preview before retrying; no retry is automatic." :
            "Delivery needs checking in Gmail Sent. Sending stopped to avoid duplicate emails.");
          break;
        }
      } catch (e) {
        const rejected = e instanceof InvitationRequestError && e.status < 500;
        update(rejected ? "ready" : "unknown");
        setError(`${e instanceof Error ? e.message : "Connection interrupted."} ${rejected ? "Refresh the preview before continuing." : "Check Gmail Sent and refresh the preview before continuing."}`); break;
      }
    }
    setNotice(`${sent} email${sent === 1 ? "" : "s"} confirmed sent${cancel.current ? "; remaining emails stopped" : ""}.`);
    setSending(false);
  }
  const chosen = preview?.invitations.find(row => row.user_id === active);
  const ready = preview?.invitations.filter(row => ["ready", "failed"].includes(row.status)) ?? [];
  const count = ready.filter(row => selected.has(row.user_id)).length;
  const busy = working || sending || connecting;

  return <div className="space-y-6">
    {config?.gmail_client_id ? <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGmailReady(true)}
      onError={() => setError("Google sign-in could not load. Check your connection or reload the page.")} /> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
      <h1 className="text-2xl font-bold text-ink">Prepare login emails</h1>
      <Link href="/teacher/students" className={button} onClick={event => {
        if ((csv || sending) && !window.confirm("Leave this page and clear the credentials? Any email already sending may still complete.")) event.preventDefault();
        else cancel.current = true;
      }}><ArrowLeft size={16} aria-hidden="true" />Student accounts</Link>
    </div>
    {loading ? <p role="status">Loading invitation settings...</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-red-700 bg-red-50 p-4 text-sm text-red-900">
      <span>{error}</span>{!config ? <button className={button} onClick={() => void load()}>Retry</button> : null}</div> : null}
    {notice ? <p role="status" className="border-l-4 border-accent bg-emerald-50 p-3 text-sm text-ink">{notice}</p> : null}
    {config ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
        <div className="min-w-0"><p className="break-all font-semibold">{config.gmail_email ? `Gmail: ${config.gmail_email}` : "Gmail not connected"}</p>
          <p className="mt-1 text-sm text-muted">{config.pending_count} pending account{config.pending_count === 1 ? "" : "s"}</p></div>
        <div className="flex flex-wrap gap-2">
          {config.gmail_email ? <button className={button} disabled={busy} onClick={() => void disconnect()}><Unplug size={16} aria-hidden="true" />Disconnect</button> :
            <button className={button} disabled={!gmailReady || busy || !config.gmail_client_id} onClick={connect}><Mail size={16} aria-hidden="true" />{connecting ? "Connecting..." : "Connect Gmail"}</button>}
        </div>
        {!config.gmail_client_id ? <p className="w-full border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">Gmail sending needs administrator setup. You can prepare and review emails now.</p> : null}
      </div>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <legend className="mb-3 text-lg font-semibold">Email template</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="min-w-0 space-y-2 text-sm font-medium">Gmail address and student contact email
            <input className={inputClass} type="email" autoComplete="email" readOnly={Boolean(config.gmail_email)} value={template.sender_email} onChange={e => edit("sender_email", e.target.value)} /></label>
          <label className="min-w-0 space-y-2 text-sm font-medium">Instructor name
            <input className={inputClass} value={template.instructor_name} onChange={e => edit("instructor_name", e.target.value)} /></label>
        </div>
        <label className="block space-y-2 text-sm font-medium">Subject<input className={inputClass} value={template.subject} maxLength={160} onChange={e => edit("subject", e.target.value)} /></label>
        <label className="block space-y-2 text-sm font-medium">Message<textarea className={`${inputClass} min-h-80 leading-6`} ref={bodyInput} value={template.body} maxLength={8000} onChange={e => edit("body", e.target.value)} /></label>
        <div className="flex flex-wrap items-center gap-2"><label className="text-sm font-medium">Insert field
          <select aria-label="Insert merge field" className="ml-2 h-10 max-w-full rounded-md border border-line bg-white px-2" value="" onChange={e => {
            const area = bodyInput.current; const start = area?.selectionStart ?? template.body.length; const end = area?.selectionEnd ?? start;
            edit("body", `${template.body.slice(0, start)}{{${e.target.value}}}${template.body.slice(end)}`); area?.focus();
          }}><option value="" disabled>Select field</option>{INVITATION_FIELDS.map(field => <option key={field} value={field}>{field.replaceAll("_", " ")}</option>)}</select></label></div>
        <div className="flex flex-wrap items-center gap-3 border-y border-line py-4">
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Credential CSV" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button className={button} type="button" onClick={() => file.current?.click()}><Upload size={16} aria-hidden="true" />Upload credential CSV</button>
          {filename ? <span className="min-w-0 break-all text-sm">{filename}</span> : <span className="text-sm text-muted">Up to 100 students; 256 KB</span>}
          {csv ? <button className={button} title="Clear uploaded credentials" aria-label="Clear uploaded credentials" onClick={() => { setCsv(""); setFilename(""); invalidate(); }}><X size={16} /></button> : null}
          <button className={primary} disabled={!csv} type="button" onClick={() => void prepare()}>{working ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{working ? "Checking accounts..." : "Preview emails"}</button>
        </div>
      </fieldset>
      {preview ? <section aria-label="Invitation previews" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Recipients ({preview.invitations.length})</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" disabled={busy || !ready.length}
            checked={ready.length > 0 && ready.every(row => selected.has(row.user_id))} onChange={e => { setSelected(new Set(e.target.checked ? ready.map(row => row.user_id) : [])); setApproved(false); }} />Select all ready emails</label></div>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <div className="min-w-0 divide-y divide-line border-y border-line">
            {preview.invitations.map(row => <div className={`flex items-start gap-3 p-3 ${active === row.user_id ? "bg-emerald-50" : ""}`} key={row.user_id}>
              <input type="checkbox" aria-label={`Email ${row.user_id}`} className="mt-1 h-4 w-4 shrink-0 accent-accent" disabled={busy || !["ready", "failed"].includes(row.status)} checked={selected.has(row.user_id)} onChange={e => {
                setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(row.user_id); else next.delete(row.user_id); return next; }); setApproved(false);
              }} /><button className="min-w-0 flex-1 text-left text-sm" onClick={() => { setActive(row.user_id); setShowPassword(false); }} aria-pressed={active === row.user_id}>
                <span className="block break-words font-semibold">{row.display_name}</span><span className="block break-all text-muted">{row.message.to}</span>
                <span className={`mt-1 block ${row.status === "sent" ? "text-accent" : row.status === "unknown" || row.status === "failed" ? "text-red-700" : "text-muted"}`}>{statusText[row.status]}</span>
              </button></div>)}
          </div>
          {chosen ? <div className="min-w-0 space-y-4" aria-label="Email preview">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm"><dt className="text-muted">To</dt><dd className="break-all">{chosen.message.to}</dd>
              <dt className="text-muted">From</dt><dd className="break-all">{chosen.message.from}</dd><dt className="text-muted">Subject</dt><dd className="break-words font-semibold">{chosen.message.subject}</dd></dl>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} className="h-4 w-4 accent-accent" />Show temporary password</label>
            <pre className="whitespace-pre-wrap break-words border-t border-line pt-4 font-sans text-sm leading-6">{showPassword ? chosen.message.body : chosen.masked_body}</pre>
          </div> : null}
        </div>
        {preview.excluded.length ? <details className="border-y border-line py-3"><summary className="cursor-pointer text-sm font-semibold">Excluded rows ({preview.excluded.length})</summary>
          <ul className="mt-3 space-y-2 text-sm">{preview.excluded.map(row => <li key={row.user_id} className="break-words">{row.user_id}: {row.reason}</li>)}</ul></details> : null}
        <div className="space-y-4 border-t border-line pt-5">
          <label className="flex items-start gap-3 text-sm"><input className="mt-0.5 h-4 w-4 shrink-0 accent-accent" type="checkbox" checked={approved} disabled={busy || !count}
            onChange={e => setApproved(e.target.checked)} />I have reviewed the recipients and login details, and approve sending {count} separate emails.</label>
          <div className="flex flex-wrap items-center gap-3"><button className={primary} disabled={busy || !approved || !count || config.gmail_email !== template.sender_email.trim().toLowerCase()}
            onClick={() => void send()}><Send size={16} aria-hidden="true" />{sending ? "Sending..." : `Send ${count} email${count === 1 ? "" : "s"} with Gmail`}</button>
            {sending ? <button className={button} onClick={() => { cancel.current = true; }}>Stop after current email</button> : null}
            {!config.gmail_email ? <span className="text-sm text-muted">Connect Gmail to send.</span> : null}
            {preview.invitations.some(row => row.status === "sent") ? <span className="inline-flex items-center gap-1 text-sm text-accent"><Check size={16} />{preview.invitations.filter(row => row.status === "sent").length} sent</span> : null}
          </div>
        </div>
      </section> : null}
    </> : null}
  </div>;
}
