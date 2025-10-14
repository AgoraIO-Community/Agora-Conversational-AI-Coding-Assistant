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

export class AgoraConversationalClient {
  private client: IAgoraRTCClient | null = null;
  private rtmClient: any = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private appId: string;
  private channel: string;
  private token: string;
  private uid: number;
  private botUid: number;
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

  async initialize() {
    // Initialize RTC client
    this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    this.client.on(
      "user-published",
      async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        await this.client!.subscribe(user, mediaType);

        if (mediaType === "audio" && user.uid === this.botUid) {
          const remoteAudioTrack = user.audioTrack;
          if (remoteAudioTrack) {
            remoteAudioTrack.play();
          }
        }
      }
    );

    this.client.on("user-unpublished", (user: IAgoraRTCRemoteUser) => {
      if (user.uid === this.botUid) {
        console.log("Bot disconnected");
      }
    });

    await this.client.join(this.appId, this.channel, this.token, this.uid);

    // Initialize RTM client for transcriptions
    await this.initializeRTM();
  }

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

      // Create RTM client with string UID
      this.rtmClient = new RTM(this.appId, String(this.uid), {
        useStringUserId: true,
      } as any);

      // Listen for connection state changes
      this.rtmClient.addEventListener("status", (status: any) => {
        console.log("RTM status change:", status);
      });

      // Listen for errors
      this.rtmClient.addEventListener("error", (error: any) => {
        console.error("RTM error event:", error);
      });

      console.log("Attempting RTM login with token...");

      // Login to RTM with the token that has both RTC and RTM2 privileges
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
        withMessage: true,
        withPresence: true,
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

      // Listen for channel messages
      this.rtmClient.addEventListener("message", (event: any) => {
        console.log("\n📨 RTM MESSAGE:", JSON.stringify(event, null, 2));

        try {
          if (event.channelName && event.channelName !== this.channel) return;

          const message = event.message;
          let data: any;

          // Parse message data
          if (typeof message === "string") {
            data = JSON.parse(message);
          } else if (message.customType === "text") {
            data = JSON.parse(message.stringData || "{}");
          } else {
            data = message;
          }

          console.log("Parsed transcription data:", data);

          // Handle transcription messages
          if (
            data.object === "assistant.transcription" ||
            data.object === "user.transcription" ||
            data.words ||
            data.text
          ) {
            // Detect agent vs user based on object type
            const isAgent = data.object === "assistant.transcription";

            const text = data.text || data.words || data.transcription || "";
            // Check for final status: turn_status === 1 OR final === true
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

            // Pass both FINAL and INTERIM transcriptions to UI (for loading states)
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

  async startMicrophone() {
    this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: "speech_standard",
    });

    await this.client!.publish([this.localAudioTrack]);
  }

  async stopMicrophone() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack.close();
      this.localAudioTrack = null;
    }
  }

  async disconnect() {
    await this.stopMicrophone();

    // Disconnect RTM
    if (this.rtmClient) {
      try {
        await this.rtmClient.unsubscribe(this.channel);
        await this.rtmClient.logout();
      } catch (err) {
        console.error("RTM disconnect error:", err);
      }
      this.rtmClient = null;
    }

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
