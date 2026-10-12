/** Cartesia voices and model. Verified with a live call before bulk generation. */
export const VOICE_CONFIG = {
  model_id: 'sonic-3.6',
  cartesia_version: '2026-08-14',
  output: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
  voices: {
    // Hindi: Siya (standard Hindi, feminine)
    hi: { id: '4459a9a5-69d6-4680-b970-e13dc51845b6', language: 'hi' },
    // English: Priya (Indian English accent, feminine)
    en: { id: 'f6141af3-5f94-418c-80ed-a45d450e7e2e', language: 'en' },
  },
} as const;
