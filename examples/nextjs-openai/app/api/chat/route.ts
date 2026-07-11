import { ShipGauge } from "@shipgauge/node";
import OpenAI from "openai";

const sg = new ShipGauge({
  apiKey: process.env.SHIPGAUGE_API_KEY!,
  projectId: process.env.SHIPGAUGE_PROJECT_ID!,
  baseUrl: process.env.SHIPGAUGE_BASE_URL ?? "http://localhost:3000",
  environment: process.env.VERCEL_ENV ?? "development",
});

const openai = sg.wrapOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }),
  { defaultTags: { feature_id: "chat" } },
);

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY || !process.env.SHIPGAUGE_API_KEY) {
    return Response.json(
      { error: "Set OPENAI_API_KEY and SHIPGAUGE_API_KEY in .env.local" },
      { status: 500 },
    );
  }

  const body = (await request.json()) as { message?: string };
  const message = body.message?.trim() || "Say hello in one word";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: message }],
  });

  return Response.json({
    reply: completion.choices[0]?.message?.content ?? "",
    model: completion.model,
    feature_id: "chat",
  });
}
