import { AppError } from '../../middleware/errorHandler';

export type OpenRouterCompletionRequest = {
  messages: Array<Record<string, unknown> & { role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** When true, we request JSON-only output suitable for strict parsing. */
  jsonMode?: boolean;
  /** Enables OpenRouter "reasoning" output (may not be compatible with strict JSON parsing). */
  reasoningEnabled?: boolean;
};

export type OpenRouterCompletionResponse = {
  content: string;
  model: string;
  reasoningDetails?: unknown;
  reasoning_details?: unknown;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

export class OpenRouterProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fallbackModels: string[];

  constructor() {
    // Development/testing fallback: allow local testing without env var.
    // IMPORTANT: Rotate/revoke this key after testing.
    const hardcodedTestKey =
      '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';
    this.apiKey = process.env.OPENROUTER_API_KEY || hardcodedTestKey;
    this.baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    this.fallbackModels = (process.env.OPENROUTER_FALLBACK_MODELS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  private getModelChain(preferred?: string): string[] {
    const first = preferred || process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';
    return [first, ...this.fallbackModels.filter((m) => m !== first)];
  }

  async complete(req: OpenRouterCompletionRequest): Promise<OpenRouterCompletionResponse> {
    if (!this.apiKey) {
      throw new AppError('OPENROUTER_API_KEY is not configured', 503, 'SERVICE_UNAVAILABLE');
    }
    const models = this.getModelChain(req.model);
    const jsonMode = req.jsonMode ?? true;
    const reasoningEnabled = req.reasoningEnabled ?? false;
    let lastError: unknown = null;
    for (const model of models) {
      const start = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: req.messages,
            temperature: req.temperature ?? 0.2,
            max_tokens: req.max_tokens ?? 2000,
            ...(reasoningEnabled ? { reasoning: { enabled: true } } : {}),
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`OpenRouter failed (${response.status}): ${text}`);
        }
        const json = (await response.json()) as any;
        const message = json?.choices?.[0]?.message || {};
        const content = String(message?.content || '').trim();
        if (!content) throw new Error('OpenRouter returned empty content');
        return {
          content,
          model,
          reasoningDetails: message?.reasoning_details,
          reasoning_details: message?.reasoning_details,
          promptTokens: Number(json?.usage?.prompt_tokens || 0),
          completionTokens: Number(json?.usage?.completion_tokens || 0),
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        lastError = err;
        // Small delay to smooth over transient provider/network errors.
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new AppError(
      `OpenRouter completion failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      503,
      'SERVICE_UNAVAILABLE'
    );
  }
}
