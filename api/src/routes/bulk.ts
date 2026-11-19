import { Router } from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { Errors } from '../errors';
import type { AppDeps } from '../http/types';
import { parse } from '../http/validate';
import { createBulkJob, getBulkJob, streamResultsCsv } from '../services/bulkJobs';

const jobIdParam = z.object({ jobId: z.uuid() });
const jsonBody = z.union([z.array(z.string()), z.object({ emails: z.array(z.string()) })]);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const HEADER_NAMES = new Set(['email', 'e-mail', 'email address', 'email_address', 'emailaddress']);

/** Pull the email column out of a CSV: use a header called "email" if present, else the first column. */
export function emailsFromCsv(text: string): string[] {
  let rows: string[][];
  try {
    rows = parseCsv(text, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
  } catch (err) {
    throw Errors.badRequest(`Could not parse CSV: ${(err as Error).message}`);
  }
  if (rows.length === 0) return [];
  const headerIdx = (rows[0] as string[]).findIndex((c) => HEADER_NAMES.has(c.toLowerCase()));
  let col = 0;
  let start = 0;
  if (headerIdx >= 0) {
    col = headerIdx;
    start = 1;
  } else if (!((rows[0] as string[])[0] ?? '').includes('@')) {
    start = 1; // unnamed header row such as "Contacts"
  }
  return rows.slice(start).map((r) => r[col] ?? '').filter(Boolean);
}

export function bulkRoutes(deps: AppDeps, authenticate: RequestHandler, limit: RequestHandler): Router {
  const r = Router();
  r.use(authenticate);

  r.post(
    '/',
    limit,
    (req, res, next) => (req.is('multipart/form-data') ? upload.single('file')(req, res, next) : next()),
    async (req, res) => {
      let emails: string[];
      if (req.file) {
        emails = emailsFromCsv(req.file.buffer.toString('utf8'));
      } else if (req.is('multipart/form-data')) {
        throw Errors.badRequest('Upload a CSV in the "file" form field');
      } else {
        const body = parse(jsonBody, req.body);
        emails = Array.isArray(body) ? body : body.emails;
      }
      const job = await createBulkJob(deps.db, {
        userId: req.auth!.userId,
        apiKeyId: req.auth!.apiKeyId,
        emails,
        maxRows: deps.config.BULK_MAX_ROWS,
      });
      res.status(202).location(`/v1/bulk/${job.jobId}`).json(job);
    },
  );

  r.get('/:jobId', async (req, res) => {
    const { jobId } = parse(jobIdParam, req.params);
    const job = await getBulkJob(deps.db, req.auth!.userId, jobId);
    if (!job) throw Errors.notFound('Bulk job not found');
    res.json(job);
  });

  r.get('/:jobId/download', async (req, res) => {
    const { jobId } = parse(jobIdParam, req.params);
    const job = await getBulkJob(deps.db, req.auth!.userId, jobId);
    if (!job) throw Errors.notFound('Bulk job not found');
    if (job.status !== 'completed') throw Errors.conflict('Job is not finished yet');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mailcheck-${jobId}.csv"`);
    for await (const chunk of streamResultsCsv(deps.db, jobId)) res.write(chunk);
    res.end();
  });

  return r;
}
