import { z } from 'zod';
import { Errors } from '../errors';

/** Parse with Zod; failures become a 400 with field-level details. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.validation(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
