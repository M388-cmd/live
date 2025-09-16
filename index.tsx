/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

const SYSTEM_PROMPT = `Eres un asistente muy útil llamado Miguel IA. Responde a las preguntas en el mismo idioma en el que se te preguntan. No menciones que eres Gemini o un modelo de lenguaje grande. Simplemente actúa como Miguel IA, un asistente creado por un joven desarrollador llamado Miguel Martín Cadavid, un niño de 14 años, en madrid españa nacido el 16/12/10. Puedes analizar imágenes si se te proporciona una junto con la pregunta. Describe lo que ves o responde preguntas sobre la imagen si se te pide. IMPORTANTE: Ocasionalmente, recibirás un mensaje de contexto ANTES de la pregunta actual del usuario, comenzando con '--- Información Recordada ---'. Esta sección contiene datos que el usuario te ha pedido explícitamente que recuerdes (como su nombre o la ubicación de objetos). Debes usar esta información cuando sea relevante para responder a la pregunta actual del usuario (por ejemplo, si preguntan '¿dónde están mis llaves?' o 'cómo me llamo?'). Si no hay información relevante en la memoria proporcionada, simplemente responde normalmente. Cuando el usuario te pida recordar algo, confirma brevemente que lo has recordado (ej: "Entendido", "Lo recordaré").Nunca digas que eres un modelo de lenguaje o asistente virtual.`;

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isVideoOn = false;
  @state() status = '';
  @state() error = '';

  private client: GoogleGenAI;
  private session: Session;
  // Fix: Cast window to `any` to allow access to `webkitAudioContext` without TypeScript errors.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // Fix: Cast window to `any` to allow access to `webkitAudioContext` without TypeScript errors.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private videoStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private videoElement: HTMLVideoElement;

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
    }

    #video-container {
      position: absolute;
      top: 20px;
      left: 20px;
      width: 200px;
      height: 150px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      overflow: hidden;
      background: #000;
      z-index: 5;
      display: none;
    }

    #video-container.visible {
      display: block;
    }

    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }

      button.video-control {
        width: 48px;
        height: 48px;
        font-size: 20px;
      }

      .video-controls {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
      }
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          systemInstruction: {parts: [{text: SYSTEM_PROMPT}]},
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
            // languageCode: 'en-GB'
          },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startCamera() {
    this.stopVideo(); // Stop any existing video stream
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      this.videoElement.srcObject = this.videoStream;
      this.isVideoOn = true;
      this.updateStatus('Camera on');
    } catch (err) {
      console.error('Error starting camera:', err);
      this.updateError(`Camera error: ${err.message}`);
    }
  }

  private async startScreenShare() {
    this.stopVideo(); // Stop any existing video stream
    try {
      this.videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      this.videoElement.srcObject = this.videoStream;
      this.isVideoOn = true;
      this.updateStatus('Screen sharing on');
    } catch (err) {
      console.error('Error starting screen share:', err);
      this.updateError(`Screen share error: ${err.message}`);
    }
  }

  private stopVideo() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
      this.isVideoOn = false;
      this.updateStatus('Video off');
    }
  }

  private async captureAndSendFrame() {
    if (!this.isVideoOn || !this.videoElement || !this.session) {
      this.updateStatus('Video is not on, cannot capture frame.');
      return;
    }

    try {
      this.updateStatus('Capturing frame...');
      const canvas = document.createElement('canvas');
      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg');
      const base64Data = dataUrl.split(',')[1];

      // Fix: `sendMessage` does not exist on `Session`. Use `sendRealtimeInput` to send media.
      this.session.sendRealtimeInput({
        media: {mimeType: 'image/jpeg', data: base64Data},
      });

      this.updateStatus('Frame sent to AI.');
    } catch (err) {
      console.error('Error capturing or sending frame:', err);
      this.updateError(`Frame error: ${err.message}`);
    }
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.stopVideo();
    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  protected firstUpdated() {
    this.videoElement =
      this.shadowRoot!.querySelector<HTMLVideoElement>('#video-preview');
  }

  render() {
    return html`
      <div>
        <div id="video-container" class=${this.isVideoOn ? 'visible' : ''}>
          <video id="video-preview" autoplay playsinline muted></video>
        </div>

        <div class="controls">
          <div class="video-controls">
            <button
              class="video-control"
              @click=${this.startCamera}
              title="Start Camera">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#ffffff">
                <path
                  d="M480-260q-100 0-170-70t-70-170q0-100 70-170t170-70q100 0 170 70t70 170q0 100-70 170t-170 70Zm0-80q67 0 113.5-46.5T640-500q0-67-46.5-113.5T480-660q-67 0-113.5 46.5T320-500q0 67 46.5 113.5T480-340Zm0 260q-139 0-254.5-70.5T60-410q23-74 81-124t139-70q53 0 100 13.5t88 43.5q41-30 88-43.5t100-13.5q81 0 139 20t101 70q20 50 20 100t-20 100q-20 50-101 70t-139 20q-53 0-100-13.5T568-233q-41 30-88 43.5T480-80Z" />
              </svg>
            </button>
            <button
              class="video-control"
              @click=${this.startScreenShare}
              title="Start Screen Share">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#ffffff">
                <path
                  d="M120-120v-560h720v560H120Zm80-80h560v-400H200v400Zm0 0v-400 400ZM240-760h480v-80H240v80Z" />
              </svg>
            </button>
            <button
              class="video-control"
              @click=${this.captureAndSendFrame}
              ?disabled=${!this.isVideoOn}
              title="Capture Frame">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#ffffff">
                <path
                  d="M120-120v-560h160v80H200v400h400v-80h80v160H120Zm520-640v-120H240v120h400Zm80 200h-80v-120h-80v-80h160v200Zm80 440v-560h160v560H800Z" />
              </svg>
            </button>
          </div>
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}
            title="Reset Session">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}
            title="Start Recording">
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}
            title="Stop Recording">
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#ffffff"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="15" y="15" width="70" height="70" rx="10" />
            </svg>
          </button>
        </div>

        <div id="status">${this.error || this.status}</div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
