'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { btnPrimary, btnSecondary, Card, ErrorNote, PageHeader, Spinner, VERDICT_STYLE } from '@/components/ui';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BulkJob, Verdict } from '@/lib/types';

const JOB_KEY = 'mailcheck.lastJob';
const POLL_MS = 1500;
const MAX_BYTES = 5 * 1024 * 1024;

const readJob = () => {
  try {
    return localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
};
const writeJob = (id: string | null) => {
  try {
    if (id) localStorage.setItem(JOB_KEY, id);
    else localStorage.removeItem(JOB_KEY);
  } catch {
    /* ignore */
  }
};

export default function BulkPage() {
  const { token, refresh } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<BulkJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resume the last job after a reload.
  useEffect(() => {
    queueMicrotask(() => setJobId(readJob()));
  }, []);

  // Poll until the job completes.
  useEffect(() => {
    if (!jobId || !token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = await api<BulkJob>(`/v1/bulk/${jobId}`, { token });
        if (stopped) return;
        setJob(next);
        setError(null);
        if (next.status === 'completed') {
          void refresh();
          return;
        }
      } catch (err) {
        if (stopped) return;
        if ((err as { status?: number }).status === 404) {
          writeJob(null);
          setJobId(null);
          setJob(null);
          return;
        }
        setError(errorMessage(err)); // keep polling: it may be a transient network blip
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, token, refresh]);

  const pick = useCallback((f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setError('Please choose a .csv file.');
    if (f.size > MAX_BYTES) return setError('That file is over the 5 MB limit.');
    setFile(f);
  }, []);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  }

  async function start() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const created = await api<BulkJob>('/v1/bulk', { method: 'POST', formData: form, token });
      writeJob(created.jobId);
      setJob(created);
      setJobId(created.jobId);
      setFile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function download() {
    if (!job || !token) return;
    setDownloading(true);
    try {
      await downloadFile(`/v1/bulk/${job.jobId}/download`, token, `mailcheck-${job.jobId.slice(0, 8)}.csv`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    writeJob(null);
    setJob(null);
    setJobId(null);
    setError(null);
  }

  const done = job?.status === 'completed';

  return (
    <>
      <PageHeader title="Bulk verify" subtitle="Upload a CSV with an “email” column (or just a list in the first column). Up to 5 MB." />

      {!jobId && (
        <Card className="p-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? 'border-brand bg-brand-soft' : 'border-line bg-paper/50'}`}
          >
            <p className="text-[15px] font-medium">{file ? file.name : 'Drag and drop your CSV here'}</p>
            <p className="mt-1 text-sm text-muted">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'or'}</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" id="csv-input" onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} className={`${btnSecondary} mt-3`}>
              {file ? 'Choose a different file' : 'Browse files'}
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={start} disabled={!file || uploading} className={btnPrimary}>
              {uploading && <Spinner />} Start verification
            </button>
          </div>
        </Card>
      )}

      {jobId && !job && !error && (
        <Card className="flex items-center gap-3 p-5 text-sm text-muted"><Spinner /> Loading job…</Card>
      )}

      {job && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {done ? 'Verification complete' : job.status === 'queued' ? 'Queued, waiting for a worker' : 'Verifying…'}
            </h2>
            <span className="font-mono text-sm tabular-nums text-muted">
              {job.progress.processed.toLocaleString()} / {job.progress.total.toLocaleString()}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress.percent}
            aria-label="Verification progress"
            className="mt-3 h-3 overflow-hidden rounded-full bg-line/70"
          >
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${job.progress.percent}%` }} />
          </div>
          <p className="mt-1.5 text-right text-xs text-muted">{job.progress.percent}%</p>

          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(['deliverable', 'risky', 'unknown', 'undeliverable'] as Verdict[]).map((v) => (
              <div key={v}>
                <dt className="flex items-center gap-2 text-sm text-muted">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${VERDICT_STYLE[v].dot}`} />
                  {VERDICT_STYLE[v].label}
                </dt>
                <dd className="font-mono text-xl font-semibold tabular-nums">{job.counts[v]}</dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-muted">Failed</dt>
              <dd className="font-mono text-xl font-semibold tabular-nums">{job.counts.failed}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button onClick={reset} className={btnSecondary}>{done ? 'Verify another file' : 'Stop watching'}</button>
            {done && (
              <button onClick={download} disabled={downloading} className={btnPrimary}>
                {downloading && <Spinner />} Download results (CSV)
              </button>
            )}
          </div>
        </Card>
      )}

      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
    </>
  );
}
