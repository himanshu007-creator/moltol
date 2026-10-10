import { z } from "zod";

/**
 * RFC 9457 `application/problem+json`. Every non-2xx response from the API uses
 * this shape so the frontend has one error contract.
 */
export const ProblemSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export function problem(
  status: number,
  title: string,
  detail?: string,
  instance?: string,
): Problem {
  return { type: "about:blank", title, status, detail, instance };
}
