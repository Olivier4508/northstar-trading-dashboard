const provider =
  (process.env.LLM_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : "gemini")).toLowerCase();
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

function sendJson(response, status, payload) {
  response.status(status).json(payload);
}

async function readRequestBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body || "{}");
  }

  return {};
}

function buildInstructions() {
  return [
    "You are Northstar's portfolio assistant for a Hyperliquid trading dashboard.",
    "Answer only from the provided portfolio context and clearly say when the context is missing.",
    "You can explain dashboard design decisions, metric definitions, risk, PnL drivers, trade behavior, and symbol attribution.",
    "Be concise, specific, and numerical. Prefer direct answers over generic trading advice.",
    "Do not recommend live trades, financial decisions, or leverage changes as instructions. Frame anything forward-looking as analysis or risk considerations.",
    "When values differ, explain the distinction between unified Portfolio Value, Perps Account, open exposure, margin used, realized PnL, and unrealized PnL.",
    "If the user asks why the app made a design choice, use the designDecisions context."
  ].join("\n");
}

function buildUserPayload(question, context) {
  return JSON.stringify({ question, context }, null, 2);
}

function extractGeminiText(payload) {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractGroqText(payload) {
  return (payload.choices ?? [])
    .map((choice) => choice.message?.content ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function providerError(providerName, payload, status) {
  const message = payload.error?.message ?? `${providerName} request failed with HTTP ${status}.`;
  const code = payload.error?.code;
  const statusText = payload.error?.status ?? "";

  if (status === 429 || code === 429 || statusText.includes("RESOURCE_EXHAUSTED")) {
    return `${providerName} quota or rate limit was hit. Wait for the limit to reset or switch LLM_PROVIDER in Vercel.`;
  }

  return message;
}

async function askGemini(question, context) {
  if (!geminiApiKey) {
    return {
      status: 503,
      payload: { error: "GEMINI_API_KEY is not set on the hosted project." }
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildInstructions() }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserPayload(question, context) }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 450,
          temperature: 0.2
        }
      })
    }
  );
  const payload = await response.json();

  if (!response.ok) {
    return {
      status: response.status,
      payload: { error: providerError("Gemini", payload, response.status) }
    };
  }

  return {
    status: 200,
    payload: {
      answer: extractGeminiText(payload) || "I could not produce an answer from the current context.",
      model: payload.modelVersion ?? geminiModel,
      provider: "gemini",
      responseId: payload.responseId
    }
  };
}

async function askGroq(question, context) {
  if (!groqApiKey) {
    return {
      status: 503,
      payload: { error: "GROQ_API_KEY is not set on the hosted project." }
    };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: groqModel,
      messages: [
        { role: "system", content: buildInstructions() },
        { role: "user", content: buildUserPayload(question, context) }
      ],
      max_tokens: 450,
      temperature: 0.2
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    return {
      status: response.status,
      payload: { error: providerError("Groq", payload, response.status) }
    };
  }

  return {
    status: 200,
    payload: {
      answer: extractGroqText(payload) || "I could not produce an answer from the current context.",
      model: payload.model ?? groqModel,
      provider: "groq",
      responseId: payload.id
    }
  };
}

async function askProvider(question, context) {
  if (provider === "groq") return askGroq(question, context);
  if (provider === "gemini" || provider === "google") return askGemini(question, context);

  return {
    status: 400,
    payload: { error: `Unsupported LLM_PROVIDER "${provider}". Use "gemini" or "groq".` }
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readRequestBody(request);
  const question = String(body.question ?? "").trim();

  if (!question) {
    sendJson(response, 400, { error: "Missing question." });
    return;
  }

  const result = await askProvider(question, body.context);
  sendJson(response, result.status, result.payload);
}
