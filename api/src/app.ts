import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './logger';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { bucketForAuth, bucketForIp, rateLimit } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { bulkRoutes } from './routes/bulk';
import { authRoutes } from './routes/auth';
import { keyRoutes } from './routes/keys';
import { usageRoutes } from './routes/usage';
import { demoRoutes, verifyRoutes } from './routes/verify';
import { createRateLimiter } from './services/rateLimiter';
import type { AppDeps } from './http/types';

export function createApp(deps: AppDeps): Express {
  const { db, config } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id as string,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
        'X-Credits-Remaining',
        'Content-Disposition',
      ],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  const limiter = createRateLimiter(db);
  const auth = authenticate(db, config);
  const perKey = rateLimit({
    limiter,
    limit: config.RATE_LIMIT_MAX,
    windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
    bucket: bucketForAuth,
  });
  const demoLimit = rateLimit({
    limiter,
    limit: config.DEMO_RATE_LIMIT_MAX,
    windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
    bucket: bucketForIp('demo'),
  });
  // Brute-force guard on login/register, per IP.
  const authLimit = rateLimit({
    limiter,
    limit: 20,
    windowSeconds: 60,
    bucket: bucketForIp('auth'),
  });

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.use('/v1/auth', authRoutes(deps, auth, authLimit));
  app.use('/v1/keys', keyRoutes(deps, auth));
  app.use('/v1/usage', usageRoutes(deps, auth));
  app.use('/v1/bulk', bulkRoutes(deps, auth, perKey));
  app.use('/v1/demo', demoRoutes(deps, demoLimit));
  app.use('/v1', verifyRoutes(deps, auth, perKey));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
