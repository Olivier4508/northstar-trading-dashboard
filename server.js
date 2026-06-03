import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const cwd = process.cwd();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const maxBodyBytes = 1_500_000;

function loadEnvFile(fileName) {
  const filePath = join(cwd, fileName);
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const provider =
  (process.env.LLM_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : "gemini")).toLowerCase();
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
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
    return `${providerName} quota or rate limit was hit. Wait for the limit to reset or switch LLM_PROVIDER.`;
  }

  return message;
}

async function askGemini(question, context) {
  if (!geminiApiKey) {
    return {
      status: 503,
      payload: { error: "GEMINI_API_KEY is not set." }
    };
  }

  const geminiResponse = await fetch(
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
  const payload = await geminiResponse.json();

  if (!geminiResponse.ok) {
    return {
      status: geminiResponse.status,
      payload: { error: providerError("Gemini", payload, geminiResponse.status) }
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
      payload: { error: "GROQ_API_KEY is not set." }
    };
  }

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
  const payload = await groqResponse.json();

  if (!groqResponse.ok) {
    return {
      status: groqResponse.status,
      payload: { error: providerError("Groq", payload, groqResponse.status) }
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

async function handleAssistant(request, response) {
  const body = await readJsonBody(request);
  const question = String(body.question ?? "").trim();

  if (!question) {
    sendJson(response, 400, { error: "Missing question." });
    return;
  }

  const result = await askProvider(question, body.context);
  sendJson(response, result.status, result.payload);
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${host}:${port}`);
  const urlPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(cwd, urlPath));

  if (!filePath.startsWith(cwd) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
  });

  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/assistant") {
      await handleAssistant(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Northstar dashboard running on http://${host}:${port}`);
});
