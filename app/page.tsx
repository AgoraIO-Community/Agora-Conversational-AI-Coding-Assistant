"use client";

import { useState, useEffect, useRef } from "react";
import type { AgoraConversationalClient as AgoraClientType } from "@/lib/agora-client";
import JSZip from "jszip";
import { Mic, MicOff, LogOut } from "lucide-react";

interface TranscriptMessage {
  id: string;
  type: "user" | "agent";
  text: string;
  timestamp: Date;
}

interface CodeBlock {
  id: string;
  html: string;
  timestamp: Date;
}

// Helper function to format HTML code for better readability
function formatHTML(html: string): string {
  let formatted = "";
  let indent = 0;
  const tab = "  "; // 2 spaces

  // Simple HTML formatter
  html.split(/(<[^>]+>)/g).forEach((token) => {
    if (!token.trim()) return;

    if (token.startsWith("</")) {
      // Closing tag - decrease indent before adding
      indent = Math.max(0, indent - 1);
      formatted += "\n" + tab.repeat(indent) + token;
    } else if (
      token.startsWith("<") &&
      !token.endsWith("/>") &&
      !token.startsWith("<!")
    ) {
      // Opening tag - add then increase indent
      formatted += "\n" + tab.repeat(indent) + token;
      // Don't increase indent for self-closing-like tags or inline tags
      if (!token.match(/<(br|hr|img|input|meta|link)/i)) {
        indent++;
      }
    } else if (token.startsWith("<")) {
      // Self-closing or doctype
      formatted += "\n" + tab.repeat(indent) + token;
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

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [codeBlocks, setCodeBlocks] = useState<CodeBlock[]>([]);
  const [currentCode, setCurrentCode] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [showSourceCode, setShowSourceCode] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const agoraClientRef = useRef<AgoraClientType | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll the transcript container to bottom, not the whole page
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop =
        transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    // Track if iframe is focused
    let iframeFocused = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        const target = e.target as HTMLElement;

        // Allow arrow keys in form elements
        const isInputElement =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.contentEditable === "true";

        // Only prevent scrolling when iframe is focused (for games) or not in form elements
        if (!isInputElement && (iframeFocused || target.closest("iframe"))) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    // Listen for iframe focus events
    const handleFocus = (e: FocusEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "IFRAME") {
        iframeFocused = true;
      }
    };

    const handleBlur = (e: FocusEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "IFRAME") {
        iframeFocused = false;
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focus", handleFocus, true);
    document.addEventListener("blur", handleBlur, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focus", handleFocus, true);
      document.removeEventListener("blur", handleBlur, true);
    };
  }, []);

  const parseAgentResponse = (text: string) => {
    // Match HTML/CSS/JS code blocks wrapped in Chinese square brackets 【】
    // This handles cases where LLM might include markdown fences or extra text
    const codeRegex = /【[\s\S]*?】/gi;

    const codes: string[] = [];
    let spokenText = text;

    // Extract all code blocks and remove them from spoken text
    const matches = Array.from(text.matchAll(codeRegex));
    for (const match of matches) {
      let content = match[0].slice(1, -1); // Remove the 【 and 】

      // Clean up markdown code fences if present
      content = content.replace(/^```[\w]*\n?/g, "").replace(/```$/g, "");
      content = content.trim();

      // Only add if it looks like HTML
      if (content.includes("<html") || content.includes("<!DOCTYPE")) {
        codes.push(content);
        spokenText = spokenText.replace(match[0], ""); // Remove the entire 【code】 from spoken text
      }
    }

    return {
      spokenText: spokenText.trim(), // Text WITHOUT code blocks
      codes, // Array of code blocks
    };
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    setError("");

    // Reset all state when starting a new session
    setTranscript([]);
    setCodeBlocks([]);
    setCurrentCode("");
    setShowSourceCode(false);

    try {
      const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
      const staticToken = process.env.NEXT_PUBLIC_AGORA_TOKEN;
      const botUid = process.env.NEXT_PUBLIC_AGORA_BOT_UID;

      if (!appId || !botUid) {
        throw new Error("Missing Agora credentials in environment variables");
      }

      // Generate random channel name
      const channel = `agora-ai-${Math.random().toString(36).substring(2, 15)}`;
      const uid = Math.floor(Math.random() * 1000000);
      const botUidNum = parseInt(botUid, 10);

      // Get or generate token (single token with both RTC and RTM privileges)
      let token: string;

      if (staticToken) {
        token = staticToken;
      } else {
        const response = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelName: channel, uid }),
        });

        if (!response.ok) {
          throw new Error("Failed to generate token");
        }

        const data = await response.json();
        token = data.token;
      }

      // Start the conversational AI agent
      console.log("Starting agent for channel:", channel);
      const agentResponse = await fetch("/api/start-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: channel, uid }),
      });

      if (!agentResponse.ok) {
        const errorData = await agentResponse.json();
        console.error("Agent start failed:", errorData);
        throw new Error(
          `Failed to start conversational AI agent: ${errorData.error}`
        );
      }

      const agentData = await agentResponse.json();
      console.log("Agent started successfully:", agentData);

      // Store the agent ID for later cleanup
      setAgentId(agentData.agentId);

      // Dynamically import Agora client (client-side only)
      const AgoraModule = await import("@/lib/agora-client");

      // Initialize Agora client with single token (has both RTC and RTM privileges)
      const client = new AgoraModule.AgoraConversationalClient(
        appId,
        channel,
        token,
        uid,
        botUidNum
      );

      // Set up transcription callback before initializing
      client.setTranscriptionCallback((message: any) => {
        console.log("🎤 Transcription callback received:", message);

        // Parse to separate spoken text from code blocks
        const { spokenText, codes } = parseAgentResponse(message.text);

        console.log("  - Spoken text:", spokenText);
        console.log("  - Code blocks found:", codes.length);
        console.log("  - isFinal:", message.isFinal);

        // Detect if this is the greeting message
        const isGreeting =
          spokenText.toLowerCase().includes("hello") &&
          spokenText.toLowerCase().includes("coding assistant");

        // Detect if the response contains Chinese opening bracket (indicates code generation)
        // Check the original message.text since parseAgentResponse strips the brackets
        const hasChineseOpenBracket = message.text?.includes("【");

        // Show "Generating code..." when Chinese bracket detected (even if not final yet)
        // Once we see the bracket, keep showing spinner until message is final
        if (message.type === "agent" && !isGreeting && hasChineseOpenBracket) {
          if (!message.isFinal) {
            // Agent is streaming code - show loading
            setIsGeneratingCode(true);
          } else if (message.isFinal) {
            // Code generation complete - hide loading
            setIsGeneratingCode(false);
          }
        } else if (
          message.type === "agent" &&
          message.isFinal &&
          !hasChineseOpenBracket
        ) {
          // Non-code message finished - make sure loading is off
          setIsGeneratingCode(false);
        }

        // Only show FINAL spoken text in transcript (no code, no interim messages)
        if (spokenText && message.isFinal) {
          setTranscript((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              type: message.type,
              text: spokenText, // Only the spoken part, no code
              timestamp: new Date(),
            },
          ]);
        }

        // Auto-render code blocks in preview pane (only on final message)
        if (codes.length > 0 && message.isFinal) {
          codes.forEach((code, idx) => {
            console.log(
              `  - Code block ${idx + 1}:`,
              code.substring(0, 100) + "..."
            );
            const newCodeBlock = {
              id: `${Date.now()}-${Math.random()}-${idx}`,
              html: code,
              timestamp: new Date(),
            };
            setCodeBlocks((prev) => [...prev, newCodeBlock]);
            setCurrentCode(code);
          });
        }
      });

      await client.initialize();

      agoraClientRef.current = client;
      setIsConnected(true);
      setError("");

      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "agent",
          text: `Connected to channel: ${channel}. AI agent started. Activating microphone...`,
          timestamp: new Date(),
        },
      ]);

      // Auto-start microphone after connecting
      setTimeout(async () => {
        try {
          await client.startMicrophone();
          setIsMicActive(true);
          setTranscript((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              type: "user",
              text: "[Microphone active - Start talking!]",
              timestamp: new Date(),
            },
          ]);
        } catch (err) {
          console.error("Failed to auto-start microphone:", err);
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      console.error("Connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    // First, leave the conversational AI agent if we have an agentId
    if (agentId) {
      try {
        console.log("Leaving conversational AI agent:", agentId);
        await fetch("/api/leave-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
        console.log("Successfully left conversational AI agent");
      } catch (error) {
        console.error("Failed to leave agent:", error);
        // Don't block the disconnect process if leave fails
      }
      setAgentId(null);
    }

    // Then disconnect the Agora client
    if (agoraClientRef.current) {
      await agoraClientRef.current.disconnect();
      agoraClientRef.current = null;
    }

    // Clear generating code state
    setIsGeneratingCode(false);

    // Reset connection state only (keep preview and code intact)
    setIsConnected(false);
    setIsMicActive(false);
    setIsMuted(false);
    setIsGeneratingCode(false);
    setError("");
    setTranscript([]);
    // DON'T clear codeBlocks, currentCode, or showSourceCode
  };

  const handleToggleMute = async () => {
    if (!agoraClientRef.current) return;

    try {
      const newMutedState = !isMuted;
      await agoraClientRef.current.setMuted(newMutedState);
      setIsMuted(newMutedState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle mute");
      console.error("Toggle mute error:", err);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const handleMicToggle = async () => {
    if (!agoraClientRef.current) return;

    try {
      if (isMicActive) {
        await agoraClientRef.current.stopMicrophone();
        setIsMicActive(false);

        setTranscript((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: "user",
            text: "[Microphone stopped]",
            timestamp: new Date(),
          },
        ]);
      } else {
        await agoraClientRef.current.startMicrophone();
        setIsMicActive(true);

        setTranscript((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: "user",
            text: "[Microphone started]",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone error");
      console.error("Microphone error:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white">
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
        <header className="mb-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <img
                src="https://convoai.world/ConvoAI-World-logo-horizontal.png"
                alt="ConvoAI"
                className="h-5 sm:h-6 md:h-7"
              />
              <span className="text-gray-400 text-xs sm:text-sm">by</span>
              <svg
                viewBox="0 0 399.34668 137.06667"
                className="h-2.5 sm:h-3 md:h-3.5 text-gray-400 transition-all duration-300 hover:scale-105 hover:brightness-110 hover:text-[#34b7ee] translate-y-0.5"
                role="img"
                aria-label="Agora"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="m 1676.5,1027.77 c -168.56,0 -305.69,-137.129 -305.69,-305.68 0,-168.551 137.13,-305.672 305.69,-305.672 168.55,0 305.66,137.121 305.66,305.672 0,168.551 -137.11,305.68 -305.66,305.68 m 0,-474.231 c -92.95,0 -168.56,75.609 -168.56,168.551 0,92.937 75.61,168.551 168.56,168.551 92.93,0 168.55,-75.614 168.55,-168.551 0,-92.942 -75.62,-168.551 -168.55,-168.551"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 2185.11,949.031 -3.85,-3.722 -4.07,-3.938 -2.68,4.988 -2.54,4.723 c -22.03,40.938 -62.59,69.108 -108.49,75.338 l -11.34,1.54 V 416.219 l 11.43,1.66 c 62.57,9.09 125.7,57.109 125.7,143.91 v 160.27 c 0,85.332 66.43,158.98 151.23,167.671 l 8.98,0.918 v 137.222 l -10.97,-1.07 c -53.18,-5.22 -106.22,-32.109 -153.4,-77.769"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 501.902,967.207 -2.422,-3.363 -2.57,-3.547 -3.5,2.648 -3.301,2.512 C 436.578,1006.09 372.801,1027.57 305.68,1027.57 137.129,1027.57 0,890.438 0,721.887 0,553.336 137.129,416.203 305.68,416.203 c 67.121,0 130.89,21.481 184.41,62.121 l 3.32,2.512 3.492,2.648 2.567,-3.55 2.433,-3.36 c 23.231,-32.097 58.989,-53.597 98.098,-59 l 11.359,-1.558 V 1027.77 L 600,1026.21 c -39.109,-5.39 -74.867,-26.905 -98.098,-59.003 M 305.68,553.336 c -92.942,0 -168.551,75.609 -168.551,168.551 0,92.937 75.609,168.551 168.551,168.551 92.941,0 168.55,-75.614 168.55,-168.551 0,-92.942 -75.609,-168.551 -168.55,-168.551"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 2983.74,1026.2 c -39.11,-5.4 -74.86,-26.899 -98.09,-58.997 l -2.43,-3.351 -2.57,-3.559 -3.49,2.66 -3.31,2.508 c -53.52,40.629 -117.3,62.109 -184.43,62.109 -168.55,0 -305.67,-137.129 -305.67,-305.679 0,-168.547 137.12,-305.68 305.67,-305.68 67.13,0 130.91,21.48 184.44,62.109 l 3.3,2.512 3.49,2.648 2.57,-3.546 2.43,-3.364 c 23.23,-32.097 58.98,-53.597 98.09,-59 l 11.36,-1.558 V 1027.76 Z M 2689.42,553.344 c -92.93,0 -168.55,75.609 -168.55,168.547 0,92.941 75.62,168.55 168.55,168.55 92.94,0 168.55,-75.609 168.55,-168.55 0,-92.938 -75.61,-168.547 -168.55,-168.547"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 1186.88,483.656 c 69.87,56.071 114.72,142.086 114.72,238.438 0,63.441 -19.44,122.422 -52.66,171.32 -4.43,6.52 -9.19,12.789 -14.09,18.941 37.55,23.829 59.28,64.008 65.09,103.985 l 1.66,11.43 H 994.605 v -0.04 C 826.664,1027.02 690.254,890.195 690.254,722.094 c 0,-96.36 44.859,-182.391 114.75,-238.461 -13.117,-10.528 -25.391,-22.059 -36.609,-34.57 l 93.23,-102.161 c 30.809,40.59 79.539,66.864 134.309,66.864 92.936,0 168.546,-75.614 168.546,-168.551 0,-60.27 -31.82,-113.223 -79.52,-143.02 L 1178.22,0 c 74.83,55.7734 123.38,144.926 123.38,245.215 0,96.348 -44.85,182.367 -114.72,238.441 M 995.813,890.637 h 0.242 c 92.875,-0.063 168.425,-75.645 168.425,-168.543 0,-92.942 -75.61,-168.551 -168.546,-168.551 -92.942,0 -168.551,75.609 -168.551,168.551 0,92.898 75.543,168.48 168.43,168.543"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
              </svg>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
              <div className="text-left sm:text-right">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold">
                  🎯 AI Coding Assistant
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm">
                  Real-time voice interaction with live code preview
                </p>
              </div>
              {!isConnected ? (
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="px-4 sm:px-5 md:px-6 py-2 sm:py-3 rounded-lg font-semibold transition whitespace-nowrap text-sm sm:text-base text-black hover:brightness-110 w-full sm:w-auto disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{
                    backgroundImage:
                      "linear-gradient(270deg, #00c2ff, #a0faff 33%, #fcf9f8 66%, #c46ffb)",
                  }}
                >
                  {isConnecting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    "Start Session"
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                  <button
                    onClick={handleToggleMute}
                    className={`relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full transition-all duration-200 hover:scale-105 ${
                      isMuted
                        ? "bg-red-500/20 hover:bg-red-500/30 border-2 border-red-500/50"
                        : "bg-green-500/20 hover:bg-green-500/30 border-2 border-green-500/50"
                    }`}
                    title={isMuted ? "Unmute microphone" : "Mute microphone"}
                  >
                    {isMuted ? (
                      <MicOff className="w-5 h-5 sm:w-6 sm:h-6 text-red-400" />
                    ) : (
                      <Mic className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" />
                    )}
                    {!isMuted && (
                      <div className="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-green-500 rounded-full animate-pulse"></div>
                    )}
                  </button>

                  <button
                    onClick={handleDisconnect}
                    className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-slate-700/50 hover:bg-red-500/20 border border-slate-600 hover:border-red-500/50 rounded-full transition-all duration-200 hover:scale-105 text-xs sm:text-sm font-medium"
                    title="End session"
                  >
                    <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300" />
                    <span className="text-slate-300">End</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Code View Panel - Larger */}
          <div className="lg:col-span-4 bg-slate-800/50 backdrop-blur rounded-lg p-4 sm:p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3 sm:gap-0">
              <h2 className="text-lg sm:text-xl font-bold text-slate-200">
                {showSourceCode ? "Source Code" : "Preview"}
              </h2>
              <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
                {codeBlocks.length > 1 && (
                  <div className="flex items-center gap-1 sm:gap-2">
                    <label className="text-xs sm:text-sm text-slate-300">
                      Version:
                    </label>
                    <select
                      value={codeBlocks.findIndex(
                        (b) => b.html === currentCode
                      )}
                      onChange={(e) => {
                        const idx = parseInt(e.target.value);
                        if (idx >= 0 && idx < codeBlocks.length) {
                          setCurrentCode(codeBlocks[idx].html);
                        }
                      }}
                      className="bg-slate-700 text-white px-2 sm:px-3 py-1 rounded text-xs sm:text-sm border border-slate-600 focus:outline-none focus:border-purple-500"
                    >
                      {codeBlocks.map((block, idx) => (
                        <option key={block.id} value={idx}>
                          v{idx + 1} -{" "}
                          {new Date(block.timestamp).toLocaleTimeString()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {currentCode && (
                  <>
                    <button
                      onClick={() => setShowSourceCode(!showSourceCode)}
                      className="bg-blue-600 hover:bg-blue-700 px-3 sm:px-4 py-1 rounded text-xs sm:text-sm font-semibold transition flex items-center gap-1 sm:gap-2"
                    >
                      {showSourceCode ? (
                        <>
                          <span>👁️</span>{" "}
                          <span className="hidden sm:inline">Preview</span>
                        </>
                      ) : (
                        <>
                          <span>{"</>"}</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={async () => {
                        const zip = new JSZip();
                        const timestamp = Date.now();
                        const filename = `code-${timestamp}`;

                        // Add the HTML file to the zip
                        zip.file(`${filename}.html`, currentCode);

                        // Generate the zip file
                        const blob = await zip.generateAsync({ type: "blob" });

                        // Download the zip
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${filename}.zip`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="bg-green-600 hover:bg-green-700 px-3 sm:px-4 py-1 rounded text-xs sm:text-sm font-semibold transition flex items-center gap-1 sm:gap-2"
                    >
                      <span>⬇</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div
              className="h-[400px] sm:h-[500px] lg:h-[600px] rounded-lg shadow-inner relative"
              style={{ overflow: "hidden", isolation: "isolate" }}
            >
              {currentCode ? (
                <>
                  {showSourceCode ? (
                    <div className="w-full h-full relative">
                      <button
                        onClick={handleCopyCode}
                        className="absolute top-2 right-2 z-10 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5"
                      >
                        {copied ? (
                          <>
                            <span>✓</span>
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <span>📋</span>
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <pre className="w-full h-full overflow-auto bg-slate-900 text-green-400 p-4 text-xs font-mono">
                        <code>{formatHTML(currentCode)}</code>
                      </pre>
                    </div>
                  ) : (
                    <iframe
                      srcDoc={currentCode}
                      title="Code Preview"
                      className="w-full h-full border-0 bg-white"
                      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                      style={{ display: "block", overflow: "auto" }}
                      onLoad={() => {
                        // Add focus to iframe when it loads so arrow keys work inside it
                        const iframe = document.querySelector("iframe");
                        if (iframe) {
                          iframe.focus();
                        }
                      }}
                    />
                  )}
                  {isGeneratingCode && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-10">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mx-auto mb-4"></div>
                        <p className="text-white font-semibold">
                          Generating code...
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900">
                  {isGeneratingCode ? (
                    <>
                      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-500 mb-4"></div>
                      <p className="font-semibold">Generating code...</p>
                    </>
                  ) : (
                    <p>Code will appear here when the AI generates it</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Transcript Panel - Minimal */}
          <div className="lg:col-span-1 bg-slate-800/30 backdrop-blur rounded-lg p-3 sm:p-4 shadow-lg">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-slate-300">
              Transcript
            </h2>
            <div
              ref={transcriptContainerRef}
              className="space-y-2 h-[300px] sm:h-[400px] lg:h-[600px] overflow-y-auto text-sm"
            >
              {transcript.length === 0 ? (
                <p className="text-slate-500 text-center py-4 text-xs">
                  Conversation log
                </p>
              ) : (
                transcript.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-2 rounded ${
                      msg.type === "user"
                        ? "bg-blue-600/20"
                        : "bg-purple-600/20"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-medium text-slate-400">
                        {msg.type === "user" ? "👤" : "🤖"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {msg.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {msg.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 bg-slate-800/50 backdrop-blur rounded-lg p-4 sm:p-6">
          <h3 className="text-lg sm:text-xl font-bold mb-3">How it works</h3>
          <ul className="space-y-2 text-slate-300 text-sm sm:text-base">
            <li>
              • Click "Start Session" to establish a connection with the
              conversational AI
            </li>
            <li>• Your microphone will activate automatically</li>
            <li>
              • The code appears in the preview pane in a sandboxed iframe
            </li>
            <li>• Ask the AI to create any web-based application.</li>
          </ul>
        </div>

        {/* Footer */}
        <footer className="mt-8 sm:mt-12 border-t border-slate-700 pt-4 sm:pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-slate-400 text-xs sm:text-sm">
            <span>Powered by</span>
            <a
              href="https://www.agora.io"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-[#34b7ee] transition-colors duration-200 translate-y-1"
            >
              <svg
                viewBox="0 0 399.34668 137.06667"
                className="h-3 sm:h-4 transition-all duration-300 hover:scale-105"
                role="img"
                aria-label="Agora"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="m 1676.5,1027.77 c -168.56,0 -305.69,-137.129 -305.69,-305.68 0,-168.551 137.13,-305.672 305.69,-305.672 168.55,0 305.66,137.121 305.66,305.672 0,168.551 -137.11,305.68 -305.66,305.68 m 0,-474.231 c -92.95,0 -168.56,75.609 -168.56,168.551 0,92.937 75.61,168.551 168.56,168.551 92.93,0 168.55,-75.614 168.55,-168.551 0,-92.942 -75.62,-168.551 -168.55,-168.551"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 2185.11,949.031 -3.85,-3.722 -4.07,-3.938 -2.68,4.988 -2.54,4.723 c -22.03,40.938 -62.59,69.108 -108.49,75.338 l -11.34,1.54 V 416.219 l 11.43,1.66 c 62.57,9.09 125.7,57.109 125.7,143.91 v 160.27 c 0,85.332 66.43,158.98 151.23,167.671 l 8.98,0.918 v 137.222 l -10.97,-1.07 c -53.18,-5.22 -106.22,-32.109 -153.4,-77.769"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 501.902,967.207 -2.422,-3.363 -2.57,-3.547 -3.5,2.648 -3.301,2.512 C 436.578,1006.09 372.801,1027.57 305.68,1027.57 137.129,1027.57 0,890.438 0,721.887 0,553.336 137.129,416.203 305.68,416.203 c 67.121,0 130.89,21.481 184.41,62.121 l 3.32,2.512 3.492,2.648 2.567,-3.55 2.433,-3.36 c 23.231,-32.097 58.989,-53.597 98.098,-59 l 11.359,-1.558 V 1027.77 L 600,1026.21 c -39.109,-5.39 -74.867,-26.905 -98.098,-59.003 M 305.68,553.336 c -92.942,0 -168.551,75.609 -168.551,168.551 0,92.937 75.609,168.551 168.551,168.551 92.941,0 168.55,-75.614 168.55,-168.551 0,-92.942 -75.609,-168.551 -168.55,-168.551"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 2983.74,1026.2 c -39.11,-5.4 -74.86,-26.899 -98.09,-58.997 l -2.43,-3.351 -2.57,-3.559 -3.49,2.66 -3.31,2.508 c -53.52,40.629 -117.3,62.109 -184.43,62.109 -168.55,0 -305.67,-137.129 -305.67,-305.679 0,-168.547 137.12,-305.68 305.67,-305.68 67.13,0 130.91,21.48 184.44,62.109 l 3.3,2.512 3.49,2.648 2.57,-3.546 2.43,-3.364 c 23.23,-32.097 58.98,-53.597 98.09,-59 l 11.36,-1.558 V 1027.76 Z M 2689.42,553.344 c -92.93,0 -168.55,75.609 -168.55,168.547 0,92.941 75.62,168.55 168.55,168.55 92.94,0 168.55,-75.609 168.55,-168.55 0,-92.938 -75.61,-168.547 -168.55,-168.547"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
                <path
                  d="m 1186.88,483.656 c 69.87,56.071 114.72,142.086 114.72,238.438 0,63.441 -19.44,122.422 -52.66,171.32 -4.43,6.52 -9.19,12.789 -14.09,18.941 37.55,23.829 59.28,64.008 65.09,103.985 l 1.66,11.43 H 994.605 v -0.04 C 826.664,1027.02 690.254,890.195 690.254,722.094 c 0,-96.36 44.859,-182.391 114.75,-238.461 -13.117,-10.528 -25.391,-22.059 -36.609,-34.57 l 93.23,-102.161 c 30.809,40.59 79.539,66.864 134.309,66.864 92.936,0 168.546,-75.614 168.546,-168.551 0,-60.27 -31.82,-113.223 -79.52,-143.02 L 1178.22,0 c 74.83,55.7734 123.38,144.926 123.38,245.215 0,96.348 -44.85,182.367 -114.72,238.441 M 995.813,890.637 h 0.242 c 92.875,-0.063 168.425,-75.645 168.425,-168.543 0,-92.942 -75.61,-168.551 -168.546,-168.551 -92.942,0 -168.551,75.609 -168.551,168.551 0,92.898 75.543,168.48 168.43,168.543"
                  fill="currentColor"
                  fillRule="nonzero"
                  transform="matrix(0.13333333,0,0,-0.13333333,0,137.06667)"
                ></path>
              </svg>
            </a>
            <span>Conversational AI</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
