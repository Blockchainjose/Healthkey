import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM = `
You are HealthKey Companion, an informational health assistant.
Provide general information only. Do NOT diagnose or prescribe.
Always include: "This is not medical advice."
Encourage seeking a clinician for urgent or personal concerns.
When the user grants context, summarize relevant metrics briefly (steps, HR, BP, glucose).
Keep answers concise and structured with bullets when helpful.
`;

// Health check route (optional, but useful for debugging)
app.get("/api/ai/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "healthkey-ai",
    port: Number(process.env.PORT) || 8787,
    hasKey: !!process.env.OPENAI_API_KEY,
  });
});

// AI ask route

app.post("/api/ai/ask", async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body as {
      question: string;
      context?: any;
    };

    const contextText = context ? JSON.stringify(context).slice(0, 1200) : "";

    // ✅ Type the messages so 'role' is the correct union type
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      ...(contextText
        ? [{ role: "user", content: `User context (optional): ${contextText}` } as ChatCompletionMessageParam]
        : []),
      { role: "user", content: question },
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages,
    });

    const answer =
      resp.choices[0]?.message?.content ??
      "Sorry, I could not generate a response.";

    res.json({ ok: true, answer });
  } catch (e: any) {
    console.error("AI route error:", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "AI error" });
  }
});


const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  console.log(`HealthKey AI server listening on :${PORT}`);
});
