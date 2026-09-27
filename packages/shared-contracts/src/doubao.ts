import { z } from "zod";

export const DOUBAO_OPEN_METHOD = "codexhost/doubao/open";
export const doubaoOpenParamsSchema = z.object({}).strict();
export const doubaoOpenResultSchema = z.object({ application: z.literal("doubao") }).strict();
export type DoubaoOpenResult = z.infer<typeof doubaoOpenResultSchema>;
