import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ApiError } from '../errors';
import { logger } from '../logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'not_found', `Route not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'internal_error';
  let message = 'Internal server error';
  let details: unknown = null;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
    for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'payload_too_large' : 'bad_request';
    message = err.message;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body is not valid JSON';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'Request body is too large';
  } else {
    (req.log ?? logger).error({ err, requestId: req.id }, 'unhandled error');
  }

  if (res.headersSent) return;
  res.status(status).json({ error: { code, message, details } });
};
