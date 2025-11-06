# 🎯 AI Coding Assistant - Conversational AI Demo

A powerful Next.js application featuring real-time voice interaction with an AI coding assistant powered by Agora Conversational AI. Talk to the AI and watch it generate HTML/CSS/JS code that renders live in your browser!

Built by [ConvoAI](https://convoai.world) × [Agora](https://www.agora.io)

## ✨ Features

- 🎤 **Voice Interaction**: Natural voice conversations with AI using Agora RTC
- 💻 **Live Code Generation**: AI-generated code appears in real-time
- 🖼️ **Sandboxed Preview**: Code renders safely in an isolated iframe
- 🔄 **Source/Preview Toggle**: Switch between rendered preview and raw HTML source
- 📝 **Live Transcript**: See the full conversation history with timestamps
- 🔇 **Mic Control**: Mute/unmute microphone with visual feedback
- 📦 **Code Download**: Export generated code as a .zip file
- 🎨 **Modern UI**: Beautiful gradient design with responsive layout
- 🚀 **Smart Loading**: Context-aware "Generating code..." indicator
- 🌐 **Auto Images**: Uses Picsum Photos for all image generation

## 🎬 How It Works

1. **Start Session**: Click the gradient "Start Session" button to connect
2. **Talk Naturally**: Your microphone activates automatically - just start talking
3. **Watch Magic Happen**: The AI responds with voice and generates code live
4. **See Results**: Code renders instantly in the preview pane
5. **Explore**: Toggle to source view, download as .zip, or keep chatting

### Code Format

The AI wraps code in **black lenticular brackets** `【】` to separate it from spoken text:

```
Here's a beautiful button 【<!DOCTYPE html><html>...</html>】 that you can interact with.
```

- Text outside `【】` is spoken by the AI's voice
- Code inside `【】` is rendered visually in the preview pane
- The TTS automatically skips the code blocks

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Agora App Credentials
NEXT_PUBLIC_AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_app_certificate

# Agora RESTful API Credentials (for Conversational AI agent)
AGORA_API_KEY=your_api_key
AGORA_API_SECRET=your_api_secret

# Bot Configuration
NEXT_PUBLIC_AGORA_BOT_UID=1001

# LLM Configuration (OpenAI GPT-4o)
LLM_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=your_openai_api_key

# TTS Configuration (Microsoft Azure)
TTS_API_KEY=your_azure_tts_api_key
TTS_REGION=eastus
```

**Where to get these values:**

1. **Agora Credentials**: Sign up at [Agora Console](https://console.agora.io/)
   - Create a project → Get App ID and App Certificate
   - Enable Conversational AI → Get API Key & Secret

2. **OpenAI API Key**: Get from [OpenAI Platform](https://platform.openai.com/api-keys)
   - Uses GPT-4o model for best code generation

3. **Azure TTS**: Create resource at [Azure Portal](https://portal.azure.com)
   - Uses `en-US-AndrewMultilingualNeural` voice

📚 **See `ENV_SETUP.md` for detailed setup instructions**

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🏗️ Architecture

### Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS with custom gradients
- **Icons**: Lucide React (professional icon library)
- **Real-time Communication**: Agora RTC SDK 4.x
- **Real-time Messaging**: Agora RTM SDK 2.x
- **AI Integration**: Agora Conversational AI (GPT-4o + Azure TTS)
- **File Export**: JSZip for client-side .zip generation

### Project Structure

```
ai_coding_assistant/
├── app/
│   ├── api/
│   │   ├── token/route.ts          # Dynamic RTC token generation
│   │   ├── start-agent/route.ts    # Start Conversational AI agent
│   │   └── leave-agent/route.ts    # Clean up agent on disconnect
│   ├── page.tsx                    # Main UI component
│   ├── layout.tsx                  # Root layout with metadata
│   └── globals.css                 # Global styles
├── lib/
│   └── agora-client.ts             # Agora RTC/RTM wrapper class
├── .env.local                      # Environment variables (create this)
└── package.json                    # Dependencies
```

### Key Components

#### `app/page.tsx`

Main UI component with:

- Voice interaction controls (mic, mute, disconnect)
- Live code preview with iframe sandbox
- Source code viewer with syntax highlighting
- Transcript panel with auto-scroll
- Smart loading indicators

#### `lib/agora-client.ts`

Agora client wrapper featuring:

- RTC audio streaming
- RTM messaging for transcription
- Microphone control (mute/unmute)
- Clean disconnect logic

#### API Routes

- **`/api/token`**: Generates RTC tokens server-side for security
- **`/api/start-agent`**: Initializes Conversational AI agent with custom prompt
- **`/api/leave-agent`**: Properly shuts down the AI agent

### Connection Flow

```
1. User clicks "Start Session"
   ↓
2. Generate random channel name (e.g., "agora-ai-abc123xyz")
   ↓
3. Request RTC token from /api/token
   ↓
4. Start Conversational AI agent via /api/start-agent
   ↓
5. Initialize Agora RTC client + join channel
   ↓
6. Subscribe to RTM transcription messages
   ↓
7. Auto-activate microphone
   ↓
8. User talks → AI responds with voice + code
```

### Disconnect Flow

```
1. User clicks "End" button
   ↓
2. Call /api/leave-agent to stop AI agent
   ↓
3. Disconnect Agora RTC/RTM client
   ↓
4. Reset all state (transcript, code, UI)
   ↓
5. Ready for new session
```

## 🎨 UI Features

### Header

- **ConvoAI Logo** + **Agora Logo** branding
- Responsive layout (mobile-friendly)
- Gradient "Start Session" button
- Connection status indicator

### Control Buttons

- **Mic Button**: Circular with 🎤/🔇 Lucide icons, green/red states, animated pulse
- **End Button**: Pill-shaped with exit icon, smooth hover effects

### Preview Panel

- **Toggle View**: Switch between rendered preview and source code
- **Download**: Export code as .zip file with single click
- **Smart Loading**: "Generating code..." only shows when relevant
- **Dark Empty State**: Professional look before code loads

### Transcript Panel

- **Auto-scroll**: New messages scroll smoothly into view
- **Internal Scrolling**: Won't affect the main page
- **Timestamp**: Each message shows when it was sent
- **Speaker Labels**: Clear "You" vs "AI" distinction

## 🔒 Security

- **Sandboxed Iframe**: Code runs isolated with `sandbox="allow-scripts"`
- **Server-side Tokens**: App Certificate never exposed to client
- **Environment Variables**: All credentials stored securely
- **No DOM Access**: Generated code can't access parent page
- **Content Security**: XSS prevention through iframe isolation

## 🧪 Development Tips

### Testing Locally

```bash
# Install dependencies
npm install

# Run dev server with hot reload
npm run dev

# Build for production
npm run build

# Test production build
npm start
```

### Debugging

- **Browser Console**: Check for RTC/RTM connection logs
- **Server Logs**: Watch terminal for API route responses
- **Network Tab**: Monitor token generation and agent API calls

### Code Generation Tips

Ask the AI to:

- "Create a todo list app"
- "Build a calculator with gradient buttons"
- "Make a responsive card layout with images"
- "Design a landing page hero section"
- "Build a Tetris game"

The AI will use https://picsum.photos/ for all images automatically!

## 🐛 Troubleshooting

### "Missing Agora credentials" error

✅ Check that `.env.local` exists with all required variables

### Microphone not working

✅ Allow microphone permissions in browser settings
✅ Check that no other app is using the microphone

### No audio from agent

✅ Verify `NEXT_PUBLIC_AGORA_BOT_UID` matches your agent configuration
✅ Check browser audio isn't muted

### Connection fails

✅ Verify App ID and Certificate are correct
✅ Check that tokens aren't expired (1 hour validity)
✅ Ensure API Key/Secret are valid for Conversational AI

### Code not rendering

✅ AI must wrap code in black lenticular brackets: `【<!DOCTYPE html>...】`
✅ Check browser console for parsing errors
✅ Verify TTS skip_patterns is set to `[2]` in start-agent route

### Agent not disconnecting properly

✅ Check that `/api/leave-agent` route exists
✅ Verify `agentId` is being stored and passed correctly
✅ See server logs for API call status

## 📚 Documentation

- **`ENV_SETUP.md`**: Detailed environment variable setup
- **`AGORA_API_SETUP.md`**: Agora API configuration guide
- **`API_FEATURES.md`**: API features and capabilities
- **`TRANSCRIPTION_SETUP.md`**: Transcription implementation details

## 🎯 Key Features Explained

### Black Lenticular Brackets `【】`

We use black lenticular brackets instead of regular parentheses/brackets because:

- ✅ TTS skip pattern `[2]` specifically handles these
- ✅ Won't conflict with JavaScript array syntax `[]`
- ✅ Won't conflict with function calls `()`
- ✅ More reliable than markdown code fences
- ✅ Clear visual separation in transcript

### Smart Loading Indicator

The "Generating code..." spinner only shows when:

- User says code-related keywords (create, build, make, generate, etc.)
- Not shown during greeting or casual conversation
- Auto-hides after 5 seconds if no code appears

### Zip Download

Instead of downloading raw `.html`, we:

- Create a `.zip` file client-side with JSZip
- Name it with timestamp: `generated-code-[timestamp].zip`
- Include the full HTML file inside
- Trigger browser download automatically

### Mute Control

The mic button:

- Uses Agora SDK's `setEnabled()` method
- Shows proper mic icons from Lucide React
- Green when active, red when muted
- Animated pulse dot when transmitting
- Doesn't disconnect, just stops audio

## 🚢 Deployment

### Environment Variables

Make sure to set all environment variables in your deployment platform:

- Vercel: Project Settings → Environment Variables
- Netlify: Site Settings → Build & Deploy → Environment
- AWS/GCP: Use secrets manager

### Build Command

```bash
npm run build
```

### Start Command

```bash
npm start
```

## 📝 License

MIT License - feel free to use this for your own projects!

## 🤝 Contributing

**Powered by:**

- [ConvoAI](https://convoai.world) - Conversational AI platform
- [Agora](https://www.agora.io) - Real-time engagement platform

---

**Questions?** Check the documentation files or open an issue!

**Demo:** Try it live and ask the AI to build anything you can imagine! 🚀

- [LiveDemo](https://agora-conversational-ai-coding-assi.vercel.app/) - Live Demo
