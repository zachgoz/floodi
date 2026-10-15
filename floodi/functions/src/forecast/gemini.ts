import { GoogleAuth } from "google-auth-library";
import { Explanation, ForecastDocument, ForecastPoint, validateExplanation } from "./schema";

/** Bound explanation cost as NOAA horizons grow, retaining actual endpoints
 * and extrema. Numerical forecasting always uses the complete source series. */
export function sampleExplanationPoints(points: ForecastPoint[]): ForecastPoint[] {
  const limit = 80;
  if (points.length <= limit) return points;
  let peak = 0, trough = 0;
  points.forEach((point, i) => {
    if (point.totalFt > points[peak].totalFt) peak = i;
    if (point.totalFt < points[trough].totalFt) trough = i;
  });
  const indices = new Set([0, points.length - 1, peak, trough]);
  for (let i = 0; i < limit - 4; i++) indices.add(Math.round(i * (points.length - 1) / (limit - 5)));
  return [...indices].sort((a, b) => a - b).map(i => points[i]);
}
/** Gemini prioritizes calculated claims; it cannot introduce measurements or correlations. */
export async function explainWithGemini(
  document: ForecastDocument,
): Promise<Explanation> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  // Vertex billing/API enablement may live in an existing Cloud project distinct
  // from Firebase. Keep Firebase's runtime project and storage configuration intact.
  const project = process.env.VERTEX_AI_PROJECT?.trim() || await auth.getProjectId();
  const client = await auth.getClient();
  const response = await client.request<GeminiResponse>({
    url: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/gemini-3.8-flash:generateContent`,
    method: "POST",
    timeout: 30_000,
    data: {
      systemInstruction: {
        parts: [
          {
            text: "Explain the calculated Carolina Beach flood outlook to residents. Select up to four supplied evidence IDs, prioritizing anomaly and weather information. Always include availability so limited confidence remains explicit. Use Elevated flood risk only when the calculated risk evidence says flood stage is exceeded. Never invent measurements, causes, correlations or confidence. Return only requested JSON.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({
                status: document.status,
                method: document.method,
                confidence: document.confidence,
                validationStage: document.validationStage,
                currentResidualFt: document.currentResidualFt,
                trend: document.trend,
                thresholdFt: document.thresholdFt,
                points: sampleExplanationPoints(document.points),
                forecastHorizonAt: document.points.at(-1)?.t,
                validation: document.validation,
                leadValidation: document.leadValidation,
                extension: document.extension,
                tail: document.tail,
                evidence: document.evidence,
                sources: document.sources,
                limitations: document.limitations,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        // The configured 3.8 Flash endpoint rejects MINIMAL. Use LOW with a
        // bounded reserve and reject truncated responses instead of repairing JSON.
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          required: ["headline", "evidenceIds"],
          properties: {
            headline: {
              type: "STRING",
              enum: [
                "Flood outlook",
                "Elevated flood risk",
                "No evaluated forecast",
              ],
            },
            evidenceIds: {
              type: "ARRAY",
              maxItems: 4,
              items: {
                type: "STRING",
                enum: document.evidence.map((e) => e.id),
              },
            },
          },
        },
      },
    },
  });
  return parseGeminiExplanation(response.data, document);
}

export interface GeminiResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}
class GeminiResponseError extends Error {
  constructor(message: string, public code: string, public finishReason?: string, public outputTextLength?: number, public responseTokens?: number, public thinkingTokens?: number) { super(message); this.name = 'GeminiResponseError'; }
}
export function parseGeminiExplanation(response: GeminiResponse, document: ForecastDocument): Explanation {
  const candidate = response.candidates?.[0];
  const raw = candidate?.content?.parts?.filter(part => part.thought !== true).map(part => part.text || '').join('') || '';
  const finish = candidate?.finishReason;
  const failure = (message: string, code: string) => new GeminiResponseError(message, code, finish, raw.length, response.usageMetadata?.candidatesTokenCount, response.usageMetadata?.thoughtsTokenCount);
  if (finish && finish !== 'STOP') throw failure('Gemini did not finish a complete explanation', finish === 'MAX_TOKENS' ? 'GEMINI_OUTPUT_TRUNCATED' : 'GEMINI_INCOMPLETE_RESPONSE');
  if (!raw) throw failure('Gemini returned no explanation text', 'GEMINI_EMPTY_RESPONSE');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw failure('Gemini returned incomplete or invalid JSON', 'GEMINI_INVALID_JSON'); }
  if (
    !validateExplanation(value, document.evidence) ||
    !value.evidenceIds.includes("availability") ||
    (value.headline === "No evaluated forecast" && document.status !== "unavailable") ||
    (value.headline === "Elevated flood risk" && document.explanation.headline !== "Elevated flood risk")
  ) throw failure("Unsupported Gemini explanation", 'GEMINI_UNSUPPORTED_EXPLANATION');
  return value;
}
