import AgoraRTC, {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
  IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";
import AgoraRTM from "agora-rtm-sdk";

export interface TranscriptionMessage {
  type: "user" | "agent";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

/**
 * Wrapper class for Agora RTC + RTM integration.
 * 
 * This client manages both:
 * 1. RTC (Real-Time Communication): Bidirectional audio streaming
 * 2. RTM (Real-Time Messaging): Structured data messages (transcriptions)
 * 
 * Both use the SAME token (built with buildTokenWithRtm2) which contains
 * privileges for both RTC and RTM2 operations.
 * 
 * @example
 * const client = new AgoraConversationalClient(appId, channel, token, uid, botUid);
 * client.setTranscriptionCallback((msg) => console.log(msg.text));
 * await client.initialize();
 * await client.startMicrophone();
 */
export class AgoraConversationalClient {
  private client: IAgoraRTCClient | null = null;
  private rtmClient: any = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private appId: string;
  private channel: string;
  private token: string; // Single token with RTC + RTM2 privileges
  private uid: number; // Numeric UID for RTC
  private botUid: number; // The AI agent's UID
  private onTranscription: ((message: TranscriptionMessage) => void) | null =
    null;

  constructor(
    appId: string,
    channel: string,
    token: string,
    uid: number,
    botUid: number
  ) {
    this.appId = appId;
    this.channel = channel;
    this.token = token;
    this.uid = uid;
    this.botUid = botUid;
  }

  setTranscriptionCallback(callback: (message: TranscriptionMessage) => void) {
    this.onTranscription = callback;
  }

  /**
   * Initializes both RTC and RTM connections.
   * 
   * RTC Flow:
   * 1. Create client with "rtc" mode (audio-focused)
   * 2. Set up event handlers for remote users (the AI bot)
   * 3. Join channel with token
   * 4. Subscribe to bot's audio when they publish
   * 
   * RTM Flow:
   * 1. Create RTM client (see initializeRTM)
   * 2. Login with same token (has RTM2 privileges)
   * 3. Subscribe to channel messages
   * 4. Parse transcription messages
   */
  async initialize() {
    // Initialize RTC client for audio streaming
    this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    // Listen for when users (especially the AI bot) publish audio/video
    this.client.on(
      "user-published",
      async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        await this.client!.subscribe(user, mediaType);

        // When the bot publishes audio, play it immediately
        // This is how we hear the AI's voice responses
        if (mediaType === "audio" && user.uid === this.botUid) {
          const remoteAudioTrack = user.audioTrack;
          if (remoteAudioTrack) {
            remoteAudioTrack.play(); // Play through browser's audio output
          }
        }
      }
    );

    // Listen for when users stop publishing (bot leaves)
    this.client.on("user-unpublished", (user: IAgoraRTCRemoteUser) => {
      if (user.uid === this.botUid) {
        console.log("Bot disconnected");
      }
    });

    // Join the channel (now we can send/receive audio)
    await this.client.join(this.appId, this.channel, this.token, this.uid);

    // Initialize RTM client for transcription messages
    await this.initializeRTM();
  }

  /**
   * Initializes RTM (Real-Time Messaging) for transcriptions.
   * 
   * CRITICAL: RTM2 uses string UIDs while RTC uses numeric UIDs.
   * We convert the numeric UID to string and use the SAME token
   * (which was built with buildTokenWithRtm2 to include RTM privileges).
   * 
   * The Conversational AI agent sends transcription messages via RTM with format:
   * {
   *   object: "assistant.transcription" | "user.transcription",
   *   text: "transcribed text",
   *   turn_status: 0 (interim) | 1 (final),
   *   final: boolean
   * }
   */
  private async initializeRTM() {
    try {
      // Create RTM client instance using the correct API
      const { RTM } = AgoraRTM;

      console.log("\n=== INITIALIZING RTM ===");
      console.log("App ID:", this.appId);
      console.log("User ID (string):", String(this.uid));
      console.log("Channel:", this.channel);
      console.log("Token prefix:", this.token.substring(0, 10));
      console.log("Full token:", this.token);

      // Create RTM client with string UID (RTM2 requirement)
      // Note: Same UID as RTC but converted to string
      this.rtmClient = new RTM(this.appId, String(this.uid), {
        useStringUserId: true,
      } as any);

      // Listen for connection state changes (connected, disconnected, etc.)
      this.rtmClient.addEventListener("status", (status: any) => {
        console.log("RTM status change:", status);
      });

      // Listen for errors (token expiration, network issues, etc.)
      this.rtmClient.addEventListener("error", (error: any) => {
        console.error("RTM error event:", error);
      });

      console.log("Attempting RTM login with token...");

      // Login to RTM with the token that has both RTC and RTM2 privileges
      // This token was built with buildTokenWithRtm2() in /api/token route
      try {
        await this.rtmClient.login({ token: this.token } as any);
        console.log("✅ RTM login successful!");
      } catch (loginError) {
        console.error("❌ RTM login error:", loginError);
        console.error("Token used:", this.token);
        throw loginError;
      }

      // Subscribe to channel for transcription messages
      const subscribeOptions = {
        withMessage: true, // Receive channel messages
        withPresence: true, // Get notified when users join/leave
      };

      console.log("Subscribing to channel:", this.channel);
      try {
        await this.rtmClient.subscribe(this.channel, subscribeOptions);
        console.log("✅ RTM subscription successful!");
      } catch (subError) {
        console.error("❌ RTM subscription error:", subError);
        throw subError;
      }
      console.log("======================\n");

      // Listen for channel messages (transcriptions from the AI agent)
      this.rtmClient.addEventListener("message", (event: any) => {
        console.log("\n📨 RTM MESSAGE:", JSON.stringify(event, null, 2));

        try {
          // Ignore messages from other channels (shouldn't happen, but defensive)
          if (event.channelName && event.channelName !== this.channel) return;

          const message = event.message;
          let data: any;

          // Parse message data - handle different RTM message formats
          if (typeof message === "string") {
            data = JSON.parse(message);
          } else if (message.customType === "text") {
            data = JSON.parse(message.stringData || "{}");
          } else {
            data = message;
          }

          console.log("Parsed transcription data:", data);

          // Handle transcription messages from Conversational AI agent
          // Message structure:
          // - object: "assistant.transcription" (AI) or "user.transcription" (user)
          // - text/words/transcription: The actual transcribed text
          // - turn_status: 0 (streaming/interim) or 1 (complete/final)
          // - final: boolean flag for completion
          if (
            data.object === "assistant.transcription" ||
            data.object === "user.transcription" ||
            data.words ||
            data.text
          ) {
            // Detect agent vs user based on object type
            const isAgent = data.object === "assistant.transcription";

            // Extract text from various possible field names
            const text = data.text || data.words || data.transcription || "";
            
            // Check for final status: turn_status === 1 OR final === true
            // The AI sends interim messages as it streams, then a final message when complete
            const isFinal = data.turn_status === 1 || data.final === true;

            console.log(
              `Transcription [${isAgent ? "AGENT" : "USER"}] [${
                isFinal ? "FINAL" : "INTERIM"
              }]:`,
              text.substring(0, 100) + "..."
            );
            console.log("  - Object type:", data.object);
            console.log(
              "  - turn_status:",
              data.turn_status,
              "final:",
              data.final
            );

            // Pass both FINAL and INTERIM transcriptions to UI callback
            // UI uses interim messages for loading indicators,
            // but only displays final messages in transcript
            if (text && this.onTranscription) {
              console.log(
                `✅ Passing to UI callback [${isFinal ? "FINAL" : "INTERIM"}]`
              );
              this.onTranscription({
                type: isAgent ? "agent" : "user",
                text: text,
                isFinal: isFinal,
                timestamp: Date.now(),
              });
            }
          }
        } catch (err) {
          console.error("❌ Failed to parse RTM message:", err);
        }
      });
    } catch (error) {
      console.error("Failed to initialize RTM:", error);
    }
  }

  /**
   * Starts the microphone and publishes audio to the channel.
   * 
   * The "speech_standard" encoder config optimizes for voice (vs music):
   * - Lower bitrate (saves bandwidth)
   * - Noise suppression
   * - Echo cancellation
   * - Automatic gain control
   */
  async startMicrophone() {
    this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: "speech_standard", // Optimize for voice, not music
    });

    // Publish audio track to channel (AI agent will receive it)
    await this.client!.publish([this.localAudioTrack]);
  }

  /**
   * Stops the microphone completely.
   * This requires re-initializing the track to start again.
   * Use setMuted() if you just want to temporarily disable audio.
   */
  async stopMicrophone() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop(); // Stop capturing from device
      this.localAudioTrack.close(); // Release resources
      this.localAudioTrack = null;
    }
  }

  /**
   * Disconnects from both RTC and RTM.
   * Cleanup order:
   * 1. Stop microphone
   * 2. Leave RTM channel and logout
   * 3. Leave RTC channel
   */
  async disconnect() {
    await this.stopMicrophone();

    // Disconnect RTM (stop receiving transcriptions)
    if (this.rtmClient) {
      try {
        await this.rtmClient.unsubscribe(this.channel);
        await this.rtmClient.logout();
      } catch (err) {
        console.error("RTM disconnect error:", err);
      }
      this.rtmClient = null;
    }

    // Disconnect RTC (stop audio streaming)
    if (this.client) {
      await this.client.leave();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  isMicActive(): boolean {
    return this.localAudioTrack !== null;
  }

  /**
   * Mute/unmute microphone without stopping it.
   * This is faster than stop/start and doesn't require permission prompts.
   * 
   * @param muted - true to mute, false to unmute
   */
  async setMuted(muted: boolean): Promise<void> {
    if (this.localAudioTrack) {
      await this.localAudioTrack.setEnabled(!muted);
    }
  }

  isMuted(): boolean {
    if (!this.localAudioTrack) return true;
    return !this.localAudioTrack.enabled;
  }
}
