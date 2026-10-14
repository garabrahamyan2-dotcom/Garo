
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "25kb" }));

app.use(express.static("public"));

app.use("/api/chat", rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;

const ai = apiKey ? new OpenAI({ apiKey }) : null;

app.get("/api/health", (req, res) => {
  res.json({
    name: "WOLFS AI",
    configured: Boolean(ai && model)
  });
});

app.post("/api/chat", async (req, res) => {
  if (!ai || !model) {
    return res.status(503).json({
      error: "AI-ն կարգավորված չէ։ Ստուգիր սերվերի գաղտնի կարգավորումները։"
    });
  }

  const messages = req.body?.messages;

  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 20
  ) {
    return res.status(400).json({
      error: "Հաղորդագրությունների քանակը սխալ է։"
    });
  }

  const valid = messages.every(m =>
    m &&
    ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" &&
    m.content.trim().length > 0 &&
    m.content.length <= 4000
  );

  if (!valid || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({
      error: "Հաղորդագրության ձևաչափը սխալ է։"
    });
  }

  try {
    const result = await ai.responses.create({
      model,
      instructions:
        "You are WOLFS AI, a helpful AI assistant. " +
        "Reply in Armenian when the user writes Armenian. " +
        "You also understand Russian and English. " +
        "Be friendly, clear and honest. " +
        "Never claim you performed actions you did not perform.",
      input: messages.map(m => ({
        role: m.role,
        content: m.content.trim()
      })),
      max_output_tokens: 1200
    });

    res.json({
      reply: result.output_text || "Պատասխան չստացվեց։ Փորձիր նորից։"
    });
  } catch (error) {
    console.error("WOLFS AI API error:", error.status || "unknown");

    res.status(500).json({
      error: "AI-ի հետ կապը չհաջողվեց։ Փորձիր մի փոքր ուշ։"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WOLFS AI running on port ${PORT}`);
});
