import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const cwd = process.cwd();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-nano";
const maxBodyBytes = 1_500_000;
const quotaErrorHelp =
  "OpenAI quota is exhausted or billing is not active. Add API billing/credits or raise the project monthly budget in the OpenAI Platform, then redeploy/retry.";

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

async function handleAssistant(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, {
      error: "OPENAI_API_KEY is not set. Launch the app through the local server with an OpenAI API key to enable the LLM assistant."
    });
    return;
  }

  const body = await readJsonBody(request);
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
