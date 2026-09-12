import { z } from "zod";

// Search input (§16.2). PostgreSQL parses the free-form text with
// `plainto_tsquery`, so operator escaping is not required.

export const searchQuerySchema = z
  .string()
  .trim()
  .max(200, "Search must be 200 characters or fewer");

export const searchPageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(10_000)
  .catch(1);
