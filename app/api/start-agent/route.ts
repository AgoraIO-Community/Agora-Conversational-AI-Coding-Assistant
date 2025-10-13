import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";

export async function POST(request: NextRequest) {
  try {
    const { channelName, uid } = await request.json();

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const customerId = process.env.AGORA_CUSTOMER_ID;
    const customerSecret = process.env.AGORA_CUSTOMER_SECRET;
    const botUid = process.env.NEXT_PUBLIC_AGORA_BOT_UID;
    const llmUrl = process.env.LLM_URL;
    const llmApiKey = process.env.LLM_API_KEY;
    const ttsApiKey = process.env.TTS_API_KEY;

    if (
      !appId ||
      !appCertificate ||
      !customerId ||
      !customerSecret ||
      !botUid
    ) {
      return NextResponse.json(
        { error: "Missing Agora RESTful API credentials" },
        { status: 500 }
      );
    }

    if (!llmUrl || !llmApiKey || !ttsApiKey) {
      return NextResponse.json(
        { error: "Missing LLM or TTS credentials" },
        { status: 500 }
      );
    }

    if (!channelName) {
      return NextResponse.json(
        { error: "Channel name is required" },
        { status: 400 }
      );
    }

    // Generate RTC and RTM2 token for the bot
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;

    const botToken = RtcTokenBuilder.buildTokenWithRtm2(
      appId,
      appCertificate,
      channelName,
      parseInt(botUid, 10), // RTC account (numeric UID)
      role,
      expirationTimeInSeconds, // RTC token expire
      expirationTimeInSeconds, // join channel privilege expire
      expirationTimeInSeconds, // pub audio privilege expire
      expirationTimeInSeconds, // pub video privilege expire
      expirationTimeInSeconds, // pub data stream privilege expire
      botUid, // RTM user ID (string version of UID)
      expirationTimeInSeconds // RTM token expire
    );

    console.log("\n=== BOT TOKEN GENERATED ===");
    console.log("App ID:", appId);
    console.log("Channel:", channelName);
    console.log("Bot UID:", botUid);
    console.log("Bot Token:", botToken);
    console.log("Bot Token Length:", botToken.length);
    console.log("===========================\n");

    // Note: Bot uses single token with both RTC and RTM2 privileges

    // Create Basic Auth header
    const credentials = Buffer.from(`${customerId}:${customerSecret}`).toString(
      "base64"
    );

    // Unique agent name
    const agentName = `agent-${channelName}-${Date.now()}`;

    // Start the conversational AI agent using official API structure
    // Ref: https://docs.agora.io/en/conversational-ai/rest-api/join
    console.log("\n🚀 STARTING AGENT");
    console.log(
      "Endpoint:",
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`
    );
    console.log("Agent name:", agentName);

    const requestBody = {
      name: agentName,
      properties: {
        channel: channelName,
        token: botToken,
        agent_rtc_uid: botUid,
        remote_rtc_uids: ["*"], // Subscribe to all users
        idle_timeout: 120, // 2 minutes timeout
        advanced_features: {
          enable_aivad: true, // Enable intelligent interruption
          enable_rtm: true, // Enable RTM for transcriptions
        },
        parameters: {
          data_channel: "rtm", // Use RTM for data transmission
        },
        asr: {
          language: "en-US",
          vendor: "ares",
          params: {},
        },
        tts: {
          vendor: "microsoft",
          params: {
            key: ttsApiKey,
            region: "eastus",
            voice_name: "en-US-AndrewMultilingualNeural",
          },
          skip_patterns: [2], // Skip content in Chinese square brackets 【】 - for code blocks!
        },
        llm: {
          url: llmUrl,
          api_key: llmApiKey,
          system_messages: [
            {
              role: "system",
              content:
                "You are an expert web development AI assistant. Your code will be rendered in a live sandboxed iframe preview.\n\nIMPORTANT: When you generate HTML/CSS/JS code, you MUST wrap it in CHINESE SQUARE BRACKETS like this:\n【<!DOCTYPE html><html>...</html>】\n\nThe Chinese square brackets 【】 are REQUIRED - they tell the system to render the code visually instead of speaking it.\n\nRULES:\n1. Code must be wrapped in Chinese square brackets: 【<!DOCTYPE html><html>...</html>】\n2. Put ONLY the raw HTML code inside 【】 - NO markdown code fences like ```html, NO explanatory text\n3. Start with <!DOCTYPE html> or <html immediately after the opening 【\n4. Text outside 【】 will be spoken aloud\n5. Make code self-contained with inline CSS in <style> tags and JS in <script> tags\n6. Code runs in an iframe - ensure it's responsive and standalone\n7. Use modern, clean design with good UX practices\n8. For images, use https://picsum.photos/ - Examples: https://picsum.photos/200/300 or https://picsum.photos/400 for square or https://picsum.photos/id/237/200/300 for specific image\n\nCORRECT EXAMPLE:\nHere is a button 【<!DOCTYPE html><html><head><style>button{background:red;color:white;padding:20px;border:none;}</style></head><body><button onclick=\"alert('Hi!')\">Click Me</button></body></html>】 that shows an alert.\n\nWRONG EXAMPLE (with markdown fences):\n【```html\n<!DOCTYPE html>...\n```】\n\nALWAYS use raw HTML inside the brackets, never markdown fences. Without Chinese brackets 【】, the code will be spoken instead of rendered.",
            },
          ],
          max_history: 32,
          greeting_message:
            "Hello! I'm your Agora AI coding assistant. Ask me to create any web base application, and I'll do it for you in real-time!",
          failure_message:
            "I'm having trouble processing that. Could you please try again?",
          params: {
            model: "gpt-4o",
          },
        },
        vad: {
          mode: "interrupt",
          interrupt_duration_ms: 160,
          silence_duration_ms: 640,
        },
      },
    };

    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000), // 15 second timeout
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("\n❌ AGORA API ERROR ❌");
      console.error("Status:", response.status);
      console.error("Response:", errorData);
      console.error(
        "Request body:",
        JSON.stringify(
          {
            name: agentName,
            properties: { channel: channelName, agent_rtc_uid: botUid },
          },
          null,
          2
        )
      );
      console.error("=======================\n");
      return NextResponse.json(
        { error: `Failed to start conversational AI agent: ${errorData}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("\n✅ AGENT STARTED SUCCESSFULLY ✅");
    console.log("Agent ID:", data.agent_id);
    console.log("Status:", data.status);
    console.log("================================\n");

    return NextResponse.json({
      success: true,
      agentName,
      channelName,
      botUid: botUid,
      agentId: data.agent_id,
      status: data.status,
      createTs: data.create_ts,
    });
  } catch (error) {
    console.error("Error starting agent:", error);
    return NextResponse.json(
      { error: "Failed to start conversational AI agent" },
      { status: 500 }
    );
  }
}
