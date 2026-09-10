import { z } from "zod";

// Arama girdisi (§16.2). Sorgu metni serbesttir; PostgreSQL `plainto_tsquery`
// ile ayrıştırır, operatör kaçışı gerekmez.

export const searchQuerySchema = z
  .string()
  .trim()
  .max(200, "Arama en fazla 200 karakter olabilir");

export const searchPageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(10_000)
  .catch(1);
