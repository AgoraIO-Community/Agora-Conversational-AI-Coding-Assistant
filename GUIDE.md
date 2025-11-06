# Building a Voice-Powered AI Coding Assistant with Agora Conversational AI

When I first saw the possibilities of voice-driven development tools, I knew we had to build something that would blow developers' minds at LA Tech Week. Not just another chatbot, but a real-time coding assistant that listens to your voice and generates working web applications instantly.

This guide walks you through how can we build it using Agora's Conversational AI platform. You'll learn the architecture decisions, the tricky parts we solved, and how to build your own voice-powered coding assistant.

## What We're Building

An AI coding assistant that:

- Listens to your voice using Agora RTC (Real-Time Communication)
- Processes your requests through GPT-4o
- Responds with natural speech via Azure TTS
- Generates HTML/CSS/JavaScript code that renders live in your browser
- Keeps preview and code visible even after ending the session

Watch it in action: Ask "Create a todo list app with a purple gradient" and within seconds, you'll see a fully functional app render in the preview pane while the AI explains what it built.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User's Browser                        │
├──────────────────┬─────────────────┬────────────────────────┤
│   Voice Input    │  Next.js App    │    Code Preview        │
│   (Microphone)   │  (React + TS)   │   (Sandboxed iframe)   │
└────────┬─────────┴────────┬────────┴──────────┬─────────────┘
         │                  │                    │
         │                  │                    │
    ┌────▼────┐        ┌────▼────┐         ┌────▼────┐
    │ Agora   │        │ Next.js │         │ Client  │
    │   RTC   │◄──────►│   API   │         │  State  │
    │ (Audio) │        │ Routes  │         │Management│
    └────┬────┘        └────┬────┘         └─────────┘
         │                  │
         │             ┌────▼────────────────────────┐
         │             │  Agora Conversational AI    │
         │             │  ┌──────────────────────┐   │
         └────────────►│  │  • ASR (Speech→Text) │   │
                       │  │  • LLM (GPT-4o)      │   │
                       │  │  • TTS (Text→Speech) │   │
                       │  │  • RTM (Transcripts) │   │
                       │  └──────────────────────┘   │
                       └─────────────────────────────┘
```

### Key Components

1. **Frontend (Next.js + React)**: Handles UI, state management, and real-time preview
2. **Agora RTC SDK**: Bidirectional audio streaming
3. **Agora RTM SDK**: Real-time messaging for transcripts
4. **Agora Conversational AI**: Orchestrates ASR → LLM → TTS pipeline
5. **API Routes**: Server-side token generation and agent management

## The Flow: From Voice to Code

Let me walk you through what happens when a user says "Create a calculator":

### 1. Session Initialization

```typescript
// User clicks "Start Session" → handleConnect() fires
const handleConnect = async () => {
  // Generate unique channel name
  const channel = `agora-ai-${Math.random().toString(36).substring(2, 15)}`;

  // Get RTC token with both RTC and RTM2 privileges
  const response = await fetch("/api/token", {
    method: "POST",
    body: JSON.stringify({ channelName: channel, uid }),
  });

  // Start the AI agent
  const agentResponse = await fetch("/api/start-agent", {
    method: "POST",
    body: JSON.stringify({ channelName: channel, uid }),
  });

  // Initialize Agora client and join channel
  const client = new AgoraConversationalClient(/* ... */);
  await client.initialize();
};
```

**Why this matters**: We generate a random channel name for each session to ensure isolation. The token has both RTC (for audio) and RTM2 (for messages) privileges baked in, so we only need one token instead of managing two separately.

### 2. Token Generation (Server-Side)

The `/api/token` route generates a secure token that never exposes your App Certificate to the client:

```typescript
// app/api/token/route.ts
export async function POST(request: NextRequest) {
  const { channelName, uid } = await request.json();

  // Build token with BOTH RTC and RTM2 privileges
  const token = RtcTokenBuilder.buildTokenWithRtm2(
    appId,
    appCertificate,
    channelName,
    uid, // RTC account (numeric)
    RtcRole.PUBLISHER,
    3600, // 1 hour expiration
    3600,
    3600,
    3600,
    3600, // RTC privileges
    String(uid), // RTM user ID (string)
    3600, // RTM privilege
  );

  return NextResponse.json({ token });
}
```

**Security note**: Always generate tokens server-side. Your App Certificate should never touch the browser.

### 3. Starting the Conversational AI Agent

This is where the magic happens. The `/api/start-agent` route configures the entire AI pipeline:

```typescript
// app/api/start-agent/route.ts
const requestBody = {
  name: `agent-${channelName}-${Date.now()}`,
  properties: {
    channel: channelName,
    token: botToken,
    agent_rtc_uid: botUid,
    remote_rtc_uids: ["*"], // Listen to all users in channel

    // Enable smart features
    advanced_features: {
      enable_aivad: true, // AI Voice Activity Detection (interruption)
      enable_rtm: true, // Real-time messaging for transcripts
    },

    // ASR: Speech-to-text
    asr: {
      language: "en-US",
      vendor: "ares", // Agora's ASR engine
    },

    // TTS: Text-to-speech
    tts: {
      vendor: "microsoft",
      params: {
        voice_name: "en-US-AndrewMultilingualNeural",
      },
      skip_patterns: [2], // Skip content in 【】 brackets
    },

    // LLM: The brain
    llm: {
      url: "https://api.openai.com/v1/chat/completions",
      api_key: llmApiKey,
      system_messages: [
        {
          role: "system",
          content: "You are an expert web development AI assistant...",
        },
      ],
      params: {
        model: "gpt-4o",
      },
    },
  },
};
```

**The skip_patterns trick**: Notice `skip_patterns: [2]`? This tells the TTS engine to skip content wrapped in black lenticular brackets `【】`. That's how we prevent the AI from reading aloud 500 lines of HTML code.

### 4. The Critical System Prompt

Here's the system prompt that makes the code generation work:

````text
You are an expert web development AI assistant. Keep spoken responses SHORT and concise.

IMPORTANT: When you generate HTML/CSS/JS code, you MUST wrap it in BLACK LENTICULAR BRACKETS like this:
【<!DOCTYPE html><html>...</html>】

The black lenticular brackets 【】 are REQUIRED - they tell the system to render the code visually instead of speaking it.

RULES:
1. Code must be wrapped in black lenticular brackets: 【<!DOCTYPE html><html>...</html>】
2. Put ONLY the raw HTML code inside 【】 - NO markdown code fences like ```html
3. Start with <!DOCTYPE html> or <html immediately after the opening 【
4. Text outside 【】 will be spoken aloud - KEEP IT BRIEF
5. Make code self-contained with inline CSS in <style> tags and JS in <script> tags
6. Use modern, clean design with good UX practices
7. For images, use https://picsum.photos/

CORRECT EXAMPLE:
Here's a button 【<!DOCTYPE html><html>...</html>】 that shows an alert.

WRONG EXAMPLE:
【```html
<!DOCTYPE html>...
```】
````

**Why black lenticular brackets?** Regular brackets `[]` conflict with JavaScript arrays and JSON. Markdown fences break the TTS skip pattern. Black lenticular brackets `【】` are unique, rarely appear in natural conversation, and work perfectly with `skip_patterns: [2]`.

### 5. Real-Time Audio & Messaging

Once the agent joins the channel, we establish two parallel connections:

#### RTC Connection (Audio)

```typescript
// lib/agora-client.ts
async initialize() {
  // Create RTC client for audio
  this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  // Listen for bot's audio
  this.client.on("user-published", async (user, mediaType) => {
    await this.client.subscribe(user, mediaType);

    if (mediaType === "audio" && user.uid === this.botUid) {
      user.audioTrack?.play(); // Play AI's voice
    }
  });

  // Join channel
  await this.client.join(this.appId, this.channel, this.token, this.uid);

  // Start sending our voice
  this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
  await this.client.publish([this.localAudioTrack]);
}
```

#### RTM Connection (Messages)

```typescript
// lib/agora-client.ts
private async initializeRTM() {
  const { RTM } = AgoraRTM;

  // Create RTM client (uses same token)
  this.rtmClient = new RTM(this.appId, String(this.uid), {
    useStringUserId: true,
  });

  await this.rtmClient.login({ token: this.token });
  await this.rtmClient.subscribe(this.channel, {
    withMessage: true,
    withPresence: true,
  });

  // Listen for transcription messages
  this.rtmClient.addEventListener("message", (event) => {
    const data = JSON.parse(event.message);

    // Detect message type
    const isAgent = data.object === "assistant.transcription";
    const isFinal = data.turn_status === 1 || data.final === true;

    // Send to UI callback
    if (this.onTranscription) {
      this.onTranscription({
        type: isAgent ? "agent" : "user",
        text: data.text,
        isFinal: isFinal,
        timestamp: Date.now(),
      });
    }
  });
}
```

**Why two connections?** RTC handles the actual audio streaming (low-latency, high-quality voice). RTM sends structured data like transcriptions, which we need for displaying the conversation and detecting code blocks.

### 6. Parsing the AI's Response

When the AI responds, we need to:

1. Separate spoken text from code
2. Display spoken text in the transcript
3. Render code in the preview pane

````typescript
// app/page.tsx
const parseAgentResponse = (text: string) => {
  // Regex to find content between 【】
  const codeRegex = /【[\s\S]*?】/gi;

  const codes: string[] = [];
  let spokenText = text;

  // Extract all code blocks
  const matches = Array.from(text.matchAll(codeRegex));
  for (const match of matches) {
    // Remove the 【】 brackets
    let content = match[0].slice(1, -1);

    // Clean up any markdown fences if AI added them
    content = content.replace(/^```[\w]*\n?/g, "").replace(/```$/g, "");
    content = content.trim();

    // Validate it's HTML
    if (content.includes("<html") || content.includes("<!DOCTYPE")) {
      codes.push(content);
      spokenText = spokenText.replace(match[0], ""); // Remove from spoken text
    }
  }

  return {
    spokenText: spokenText.trim(), // Text to display
    codes, // Code to render
  };
};
````

### 7. Smart Loading Indicators

Users need to know when the AI is generating code. We detect this by watching for the black lenticular opening bracket:

```typescript
// Set up transcription callback
client.setTranscriptionCallback((message) => {
  const { spokenText, codes } = parseAgentResponse(message.text);

  // Detect code generation in progress
  const hasLenticularOpenBracket = message.text?.includes("【");

  if (message.type === "agent" && hasLenticularOpenBracket) {
    if (!message.isFinal) {
      // AI is streaming code - show loading spinner
      setIsGeneratingCode(true);
    } else {
      // Code generation complete
      setIsGeneratingCode(false);
    }
  }

  // Display spoken text in transcript (only final messages)
  if (spokenText && message.isFinal) {
    setTranscript((prev) => [
      ...prev,
      {
        type: message.type,
        text: spokenText,
        timestamp: new Date(),
      },
    ]);
  }

  // Render code in preview (only final messages)
  if (codes.length > 0 && message.isFinal) {
    codes.forEach((code) => {
      setCodeBlocks((prev) => [...prev, { html: code, timestamp: new Date() }]);
      setCurrentCode(code);
    });
  }
});
```

**Why check for `isFinal`?** The AI streams responses word-by-word. We don't want to display partial sentences or render incomplete code. Only when `isFinal` is true do we know we have the complete message.

### 8. Safe Code Preview

Generated code runs in a sandboxed iframe to prevent XSS attacks:

```tsx
<iframe
  srcDoc={currentCode}
  title="Code Preview"
  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
  style={{ display: "block", overflow: "auto" }}
/>
```

**Security layers**:

- `sandbox` attribute restricts what the code can do
- `allow-scripts` lets JS run (needed for interactivity)
- `allow-same-origin` enables localStorage but still isolates from parent page
- No `allow-top-navigation` means code can't redirect the main page

### 9. Graceful Disconnection

When the user clicks "End", we properly clean up resources:

```typescript
const handleDisconnect = async () => {
  // Stop the AI agent
  if (agentId) {
    await fetch("/api/leave-agent", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
  }

  // Disconnect Agora client
  if (agoraClientRef.current) {
    await agoraClientRef.current.disconnect();
    agoraClientRef.current = null;
  }

  // Reset connection state but KEEP the preview and code
  setIsConnected(false);
  setIsMicActive(false);
  setTranscript([]);
  // Note: We DON'T clear codeBlocks or currentCode here
};
```

**New behavior**: The preview and code remain visible after ending the session. This lets users examine the results without the session running. Only when starting a new session do we reset everything.

### 10. Version Control

The app tracks all code iterations, so users can roll back:

```tsx
{
  codeBlocks.length > 1 && (
    <select
      value={codeBlocks.findIndex((b) => b.html === currentCode)}
      onChange={(e) => {
        const idx = parseInt(e.target.value);
        setCurrentCode(codeBlocks[idx].html);
      }}
    >
      {codeBlocks.map((block, idx) => (
        <option key={block.id} value={idx}>
          v{idx + 1} - {new Date(block.timestamp).toLocaleTimeString()}
        </option>
      ))}
    </select>
  );
}
```

This dropdown appears when the AI has generated multiple versions, letting users compare iterations.

## Key Implementation Details

### Token Management

Both the user and the bot need tokens, but they're generated differently:

**User Token** (`/api/token`):

- Generated per session with random UID
- Has both RTC + RTM2 privileges
- Used by browser to join channel

**Bot Token** (`/api/start-agent`):

- Generated with fixed `NEXT_PUBLIC_AGORA_BOT_UID`
- Also has RTC + RTM2 privileges
- Passed to Agora's Conversational AI service

Both use `buildTokenWithRtm2()` because we need RTM for transcripts.

### Managing Audio State

The microphone has multiple states:

- **Not started**: No audio track exists
- **Active**: Publishing audio to channel
- **Muted**: Audio track exists but disabled

```typescript
// Start microphone
async startMicrophone() {
  this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
    encoderConfig: "speech_standard", // Optimize for voice
  });
  await this.client.publish([this.localAudioTrack]);
}

// Mute (keeps track alive)
async setMuted(muted: boolean) {
  if (this.localAudioTrack) {
    await this.localAudioTrack.setEnabled(!muted);
  }
}

// Stop completely
async stopMicrophone() {
  if (this.localAudioTrack) {
    this.localAudioTrack.stop();
    this.localAudioTrack.close();
    this.localAudioTrack = null;
  }
}
```

**Why this separation?** Muting is fast and reversible (UI toggle). Stopping destroys the track and requires re-initializing the microphone (permission prompt).

### Handling Interruptions

The `enable_aivad: true` setting enables AI Voice Activity Detection:

```typescript
advanced_features: {
  enable_aivad: true,  // Let user interrupt the AI
},
vad: {
  mode: "interrupt",
  interrupt_duration_ms: 160,     // How long user speaks to interrupt
  silence_duration_ms: 640,       // Silence before AI responds
},
```

This creates natural back-and-forth conversations. If the AI starts talking but you interrupt with "wait, stop", it actually stops and listens.

### Code Formatting

Raw AI-generated HTML is often minified. We format it for readability:

```typescript
function formatHTML(html: string): string {
  let formatted = "";
  let indent = 0;
  const tab = "  ";

  html.split(/(<[^>]+>)/g).forEach((token) => {
    if (!token.trim()) return;

    if (token.startsWith("</")) {
      // Closing tag - decrease indent
      indent = Math.max(0, indent - 1);
      formatted += "\n" + tab.repeat(indent) + token;
    } else if (token.startsWith("<") && !token.endsWith("/>")) {
      // Opening tag - add then increase indent
      formatted += "\n" + tab.repeat(indent) + token;
      if (!token.match(/<(br|hr|img|input|meta|link)/i)) {
        indent++;
      }
    } else {
      // Text content
      const trimmed = token.trim();
      if (trimmed) {
        formatted += "\n" + tab.repeat(indent) + trimmed;
      }
    }
  });

  return formatted.trim();
}
```

This is used in the "Source Code" view to make the HTML readable.

## Common Pitfalls & Solutions

### Issue 1: AI Reads Code Aloud

**Problem**: Without `skip_patterns`, the AI will attempt to speak every character of HTML code.

**Solution**: Ensure `skip_patterns: [2]` is set in your TTS configuration and your system prompt explicitly tells the AI to use black lenticular brackets 【】.

### Issue 2: Code Not Rendering

**Problem**: AI generates code but nothing appears in preview.

**Solution**: Verify the AI is using 【】 brackets (check transcript) and ensure `isFinal` is true before rendering.

### Issue 3: Microphone Won't Start

**Problem**: "Permission denied" or "No microphone found"

**Solution**: Check browser permissions and ensure another app isn't using the microphone. Try Chrome or Edge for best compatibility.

## Deployment Considerations

### Environment Variables

Never commit these to git:

```bash
# .env.local (DO NOT COMMIT)
NEXT_PUBLIC_AGORA_APP_ID=abc123...
AGORA_APP_CERTIFICATE=xyz789...
AGORA_CUSTOMER_ID=cust123...
AGORA_CUSTOMER_SECRET=secret456...
NEXT_PUBLIC_AGORA_BOT_UID=1001
LLM_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=sk-...
TTS_API_KEY=...
TTS_REGION=eastus
```

**For production**:

- Set these in your hosting platform (Vercel, Netlify, AWS, etc.)
- Use separate Agora projects for dev/staging/prod
- Rotate secrets regularly

### Build & Deploy

```bash
# Install dependencies
npm install

# Build production bundle
npm run build

# Start production server
npm start
```

The app is fully server-side rendered with Next.js. Static pages are pre-rendered, API routes run on-demand.

## Testing Locally

### Quick Start

```bash
# 1. Clone the repo
git clone <your-repo>
cd la_tech_week

# 2. Install dependencies
npm install

# 3. Create .env.local with your credentials
cp .env.example .env.local
# Edit .env.local with your actual keys

# 4. Start dev server
npm run dev

# 5. Open http://localhost:3000
```

### Test Scenarios

**Basic Connection**:

1. Click "Start Session"
2. Allow microphone access
3. Wait for "Microphone active" message
4. Say "Hello" - AI should respond

**Code Generation**:

1. Say "Create a button that says hello"
2. Watch for "Generating code..." spinner
3. Code should appear in preview pane
4. Try clicking the button

**Version Control**:

1. Generate initial code
2. Say "Make it blue instead"
3. Version dropdown should show v1 and v2
4. Switch between versions

**Session Persistence**:

1. Generate some code
2. Click "End" button
3. Preview should still show the code
4. Click "Start Session" again
5. Preview should reset

### Debugging Tips

**Enable verbose logging**:

```typescript
// lib/agora-client.ts
AgoraRTC.setLogLevel(0); // 0 = debug, 4 = none
```

**Monitor network traffic**:

- Open browser DevTools → Network tab
- Filter by "WS" to see WebSocket connections
- Check `/api/token` and `/api/start-agent` responses

**Check RTM messages**:
All RTM messages are logged to console with:

```
📨 RTM MESSAGE: { ... }
```

Look for `object: "assistant.transcription"` for AI responses.

## Extending the App

### Add Code Export

Want to download as a complete project instead of just HTML?

```typescript
import JSZip from "jszip";

async function exportProject(html: string) {
  const zip = new JSZip();

  // Extract inline CSS
  const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? cssMatch[1] : "";

  // Extract inline JS
  const jsMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const js = jsMatch ? jsMatch[1] : "";

  // Create separate files
  zip.file("index.html", html);
  if (css) zip.file("styles.css", css);
  if (js) zip.file("script.js", js);
  zip.file("README.md", "# Generated by AI Coding Assistant");

  // Download
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `project-${Date.now()}.zip`;
  a.click();
}
```

### Add Syntax Highlighting

Install Prism.js for beautiful code display:

```bash
npm install prismjs @types/prismjs
```

```typescript
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";

function SourceCodeView({ code }: { code: string }) {
  const highlighted = Prism.highlight(
    formatHTML(code),
    Prism.languages.html,
    "html"
  );

  return (
    <pre className="language-html">
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}
```

### Add Voice Commands

Implement special commands that don't generate code:

```typescript
const handleVoiceCommand = (text: string) => {
  const lower = text.toLowerCase();

  if (lower.includes("clear preview")) {
    setCurrentCode("");
    return true;
  }

  if (lower.includes("show version")) {
    // Show version picker
    return true;
  }

  if (lower.includes("export code")) {
    exportProject(currentCode);
    return true;
  }

  return false; // Not a command, let AI handle it
};
```

Update the transcription callback:

```typescript
client.setTranscriptionCallback((message) => {
  if (message.type === "user" && message.isFinal) {
    const wasCommand = handleVoiceCommand(message.text);
    if (wasCommand) return; // Don't send to AI
  }

  // Normal processing...
});
```

### Add Multi-Language Support

The ASR and TTS support multiple languages:

```typescript
// In start-agent route
asr: {
  language: userSelectedLanguage, // "en-US", "es-ES", "zh-CN", etc.
  vendor: "ares",
},
tts: {
  vendor: "microsoft",
  params: {
    voice_name: getVoiceForLanguage(userSelectedLanguage),
  },
},
```

Voice options:

- English: `en-US-AndrewMultilingualNeural`
- Spanish: `es-ES-AlvaroNeural`
- French: `fr-FR-HenriNeural`
- Chinese: `zh-CN-YunxiNeural`

See [Azure TTS voice list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts) for all options.

## Performance Optimizations

### Reduce Initial Load Time

The Agora SDKs are large. Use dynamic imports:

```typescript
// Instead of:
import AgoraRTC from "agora-rtc-sdk-ng";

// Use:
const AgoraRTC = await import("agora-rtc-sdk-ng");
```

This is already done in `handleConnect`:

```typescript
const AgoraModule = await import("@/lib/agora-client");
const client = new AgoraModule.AgoraConversationalClient(/* ... */);
```

### Optimize Re-renders

Code blocks can be large. Memoize the preview:

```typescript
import { memo } from "react";

const CodePreview = memo(({ code }: { code: string }) => {
  return (
    <iframe
      srcDoc={code}
      title="Code Preview"
      sandbox="allow-scripts allow-forms allow-modals"
    />
  );
});
```

### Debounce State Updates

During code streaming, the AI might send many interim messages:

```typescript
import { useMemo } from "react";
import debounce from "lodash.debounce";

const debouncedSetIsGenerating = useMemo(
  () => debounce(setIsGeneratingCode, 300),
  [],
);
```

## What's Next?

This is just the beginning. Here's what we're considering for v2:

- **Multi-file projects**: Generate React components, not just single HTML files
- **Live collaboration**: Multiple users voice-coding together
- **Code history**: Git-like versioning with diffs
- **Deploy button**: One-click deployment to Vercel/Netlify
- **Custom components**: Train the AI on your design system
- **Visual editing**: Point and say "make that button bigger"

## Conclusion

Building this voice-powered coding assistant taught me that the future of development tools isn't just about writing code faster - it's about removing the barrier between thinking and building.

When you can say "create a todo list" and see a working app 10 seconds later, you're not just saving time. You're freeing your mind to focus on the creative parts: the UX, the interactions, the problem you're actually solving.

The Agora Conversational AI platform handles the heavy lifting:

- Crystal-clear voice transmission via RTC
- Real-time transcription via RTM
- Seamless LLM integration
- Natural-sounding TTS

All we had to do was wire it together and build a great UI.

If you build something with this architecture, I'd love to see it. Tag [@AgoraIO](https://twitter.com/agoraio) and show us what you create.

Now stop reading and start building. 🚀

---

## Live Demo

- **Live Demo**: [Check the live Demo](https://agora-conversational-ai-coding-assi.vercel.app/)

---

## Resources

- **GitHub Repository**: [Agora-Conversational-AI-Coding-Assistant](https://github.com/AgoraIO-Community/Agora-Conversational-AI-Coding-Assistant)
- **Agora Documentation**: [Conversational AI Docs](https://docs.agora.io/en/conversational-ai/overview)
- **Community Discord**: [Join the Agora Discord](https://discord.gg/uhkxjDpJsN)

Built with ❤️ by the Agora team.
