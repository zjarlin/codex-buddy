import { z } from "zod";

export const BUDDY_SPEECH_METHOD = "codexhost/buddy/speech";

/** 单次合成上限：超长回合只播报开头，避免合成耗时和音频体积失控。 */
export const BUDDY_SPEECH_TEXT_MAX_CHARACTERS = 240;

/** 返回给 Renderer 的音频上限，超过则视为不可播报，不截断出坏音频。 */
export const BUDDY_SPEECH_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

export const buddySpeechRequestSchema = z
  .object({
    text: z.string().min(1).max(BUDDY_SPEECH_TEXT_MAX_CHARACTERS),
    /** UI 语言，用于选择曼波 GPT-SoVITS 的合成语种。 */
    locale: z.string().min(2).max(10).optional(),
  })
  .strict();

export type BuddySpeechRequest = z.infer<typeof buddySpeechRequestSchema>;

export const buddySpeechResultSchema = z.object({
  audioBase64: z.string().min(1),
  format: z.enum(["wav", "mp3"]),
  characters: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});

export type BuddySpeechResult = z.infer<typeof buddySpeechResultSchema>;
