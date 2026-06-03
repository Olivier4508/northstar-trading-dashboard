const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-nano";
const quotaErrorHelp =
  "OpenAI quota is exhausted or billing is not active. Add API billing/credits or raise the project monthly budget in the OpenAI Platform, then redeploy/retry.";

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

function extractResponseText(payload) {
  if (payload.output_text) return payload.output_text;

  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
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

function getOpenAiErrorMessage(payload, status) {
  const message = payload.error?.message ?? `OpenAI request failed with HTTP ${status}.`;
  const code = payload.error?.code;

  if (status === 429 && (code === "insufficient_quota" || message.toLowerCase().includes("quota"))) {
    return quotaErrorHelp;
  }

  return message;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, {
      error: "OPENAI_API_KEY is not set on the hosted project."
    });
    return;
  }

  const body = await readRequestBody(request);
  const question = String(body.question ?? "").trim();

  if (!question) {
    sendJson(response, 400, { error: "Missing question." });
    return;
  }

  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      instructions: buildInstructions(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  question,
                  context: body.context
                },
                null,
                2
              )
            }
          ]
        }
      ],
      max_output_tokens: 450
    })
  });

  const payload = await openaiResponse.json();

  if (!openaiResponse.ok) {
    sendJson(response, openaiResponse.status, {
      error: getOpenAiErrorMessage(payload, openaiResponse.status)
    });
    return;
  }

  sendJson(response, 200, {
    answer: extractResponseText(payload) || "I could not produce an answer from the current context.",
    model: payload.model ?? openaiModel,
    responseId: payload.id
  });
}
