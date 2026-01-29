import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import SDPExchange from './components/SDPExchange';
import Logs from './components/Logs';
import Messages from './components/Messages';
import IncomingCall from './components/IncomingCall';
import VideoCall from './components/VideoCall';

type CallMessage = 
    | { type: 'call-request'; from: string }
    | { type: 'call-accept'; from: string }
    | { type: 'call-decline'; from: string }
    | { type: 'call-offer'; sdp: RTCSessionDescriptionInit }
    | { type: 'call-answer'; sdp: RTCSessionDescriptionInit }
    | { type: 'call-end'; from: string }
    | { type: 'chat'; message: string };

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const VIDEO_SELECTORS = {
    REMOTE_FULLSCREEN: '#remote-video-fullscreen',
    LOCAL_PIP: '#local-video-pip'
} as const;

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
async function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;
    
    return new Promise((resolve) => {
        const check = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', check);
    });
}

export default function App() {
    const [localSDP, setLocalSDP] = createSignal<string>('');
    const [remoteSDP, setRemoteSDP] = createSignal<string>('');
    
    const [copied, setCopied] = createSignal(false);
    const [log, setLog] = createSignal<string[]>([]);
    const [connectionStatus, setConnectionStatus] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');

    
    const [chatMessages, setChatMessages] = createSignal<Array<{text: string, isOwn: boolean}>>([]);
    const [messageInput, setMessageInput] = createSignal('');

    const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null);
    const [isInCall, setIsInCall] = createSignal(false);
    const [callStatus, setCallStatus] = createSignal<'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ending'>('idle');
    const [incomingCall, setIncomingCall] = createSignal<{from: string} | null>(null);
    const [isAudioMuted, setIsAudioMuted] = createSignal(false);
    const [isVideoMuted, setIsVideoMuted] = createSignal(false);

    function appendLog(message: string) {
        setLog(prev => [...prev, message]);
        console.log(message);
    }

    function setupVideoElement(selector: string, stream?: MediaStream): void {
        setTimeout(() => {
            const video = document.querySelector(selector) as HTMLVideoElement;
            if (video) {
                if (stream) video.srcObject = stream;
                video.play().catch(err => console.log(`Video play failed for ${selector}:`, err));
            }
        }, 100);
    }

    function ensureVideoPlaying(selector: string): void {
        const video = document.querySelector(selector) as HTMLVideoElement;
        if (video?.srcObject && video.paused) {
            video.muted = true;
            video.play().catch(() => {});
        }
    }

    function createPeerConnectionWithStatus(onDataMessage: (msg: string) => void): RTCPeerConnection {
        if (pc) return pc;
        
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        appendLog(`RTCPeerConnection created - state: ${pc.connectionState}`);

        pc.ondatachannel = (ev) => {
            appendLog(`Data channel received: ${ev.channel.label}`);
            dataChannel = ev.channel;
            dataChannel.onmessage = (e) => onDataMessage(e.data);
            dataChannel.onopen = () => appendLog('Data channel open');
            dataChannel.onclose = () => appendLog('Data channel closed');
            dataChannel.onerror = (e) => appendLog('Data channel error: ' + String(e));
        };

        pc.onconnectionstatechange = () => {
            const state = pc?.connectionState;
            appendLog(`Connection state: ${state}`);
            
            if (state === 'connected') {
                setConnectionStatus('connected');
                setLocalSDP('');
                setRemoteSDP('');
                appendLog('Connection established');
            } else if (state === 'disconnected' || state === 'failed') {
                setConnectionStatus('disconnected');
                if (isInCall()) endCall();
            }
        };

        pc.ontrack = (event) => {
            appendLog(`Track received: ${event.track.kind}`);
            if (event.streams[0]) {
                setRemoteStream(event.streams[0]);
                setupVideoElement(VIDEO_SELECTORS.REMOTE_FULLSCREEN, event.streams[0]);
            }
        };

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                appendLog(`ICE candidate: ${ev.candidate.type} ${ev.candidate.address || 'unknown'}`);
            } else {
                appendLog('ICE gathering complete');
            }
        };

        return pc;
    }

    async function copyLocalSDP() {
        try {
            await navigator.clipboard.writeText(localSDP() || '');
            setCopied(true);
            appendLog('Local SDP copied to clipboard');
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            appendLog('Copy failed: ' + String(e));
        }
    }    function sendDataMessage(message: CallMessage) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            appendLog('Cannot send message - data channel not ready');
            return;
        }
        
        try {
            dataChannel.send(JSON.stringify(message));
            appendLog(`Sent ${message.type} message`);
        } catch (error) {
            appendLog(`Failed to send ${message.type} message: ` + String(error));
        }
    }

    function sendChatMessage(text: string) {
        sendDataMessage({ type: 'chat', message: text });
    }

    function handleIncomingCall(from: string) {
        appendLog(`Incoming call from ${from}`);
        setIncomingCall({ from });
        setCallStatus('ringing');
    }

    async function startMediaAndSendOffer(): Promise<void> {
        try {
            setCallStatus('connecting');
            appendLog('Getting media for call...');

            const stream = await requestMediaPermissions();
            if (!stream) {
                sendDataMessage({ type: 'call-decline', from: 'me' });
                return;
            }

            if (pc?.connectionState === 'connected') {
                stream.getTracks().forEach(track => pc!.addTrack(track, stream));
                setIsInCall(true);
                appendLog('Media tracks added');
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                appendLog('Call offer created');
                
                sendDataMessage({ type: 'call-offer', sdp: offer });
                
                setupVideoElement(VIDEO_SELECTORS.REMOTE_FULLSCREEN);
                setupVideoElement(VIDEO_SELECTORS.LOCAL_PIP);
            } else {
                appendLog('No active connection for call');
                setCallStatus('idle');
            }
        } catch (error) {
            resetCallState();
            appendLog('Failed to start media: ' + String(error));
        }
    }

    function handleCallAccept() {
        appendLog('Call accepted by remote peer');
        if (callStatus() === 'calling') {
            startMediaAndSendOffer();
        }
    }

    function handleCallDecline() {
        appendLog('Call declined by remote peer');
        resetCallState();
    }

    function resetCallState() {
        setCallStatus('idle');
        setIsInCall(false);
    }

    

    

    

    async function handleCallOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
        try {
            appendLog('Received call offer');
            
            const stream = await requestMediaPermissions();
            if (!stream) {
                sendDataMessage({ type: 'call-decline', from: 'me' });
                return;
            }
            
            if (!pc) {
                createPeerConnectionWithStatus(onDataMessage);
            }
            
            stream.getTracks().forEach(track => pc!.addTrack(track, stream));
            appendLog('Local media tracks added');
            
            await pc!.setRemoteDescription(sdp);
            appendLog('Remote offer set');
            
            const answer = await pc!.createAnswer();
            await pc!.setLocalDescription(answer);
            appendLog('Answer created');
            
            sendDataMessage({ type: 'call-answer', sdp: answer });
            
            setIsInCall(true);
            setCallStatus('active');
            appendLog('Call established');
            
            setupVideoElement(VIDEO_SELECTORS.REMOTE_FULLSCREEN);
            setupVideoElement(VIDEO_SELECTORS.LOCAL_PIP);
            
        } catch (error) {
            appendLog('Failed to handle call offer: ' + String(error));
            sendDataMessage({ type: 'call-decline', from: 'me' });
        }
    }

    async function handleCallAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
        try {
            appendLog('Received call answer');
            
            if (!pc) {
                appendLog('No peer connection for call answer');
                return;
            }
            
            await pc.setRemoteDescription(sdp);
            setCallStatus('active');
            appendLog('Call established');
            
            setupVideoElement(VIDEO_SELECTORS.REMOTE_FULLSCREEN);
            setupVideoElement(VIDEO_SELECTORS.LOCAL_PIP);
            
        } catch (error) {
            appendLog('Failed to handle call answer: ' + String(error));
        }
    }

    function handleCallEnd() {
        appendLog('Call ended by remote peer');
        endCall();
    }

    function onDataMessage(msg: string) {
        try {
            const message: CallMessage = JSON.parse(msg);
            
            switch (message.type) {
                case 'call-request':
                    handleIncomingCall(message.from);
                    break;
                case 'call-accept':
                    handleCallAccept();
                    break;
                case 'call-decline':
                    handleCallDecline();
                    break;
                case 'call-offer':
                    handleCallOffer(message.sdp);
                    break;
                case 'call-answer':
                    handleCallAnswer(message.sdp);
                    break;
                case 'call-end':
                    handleCallEnd();
                    break;
                case 'chat':
                    setChatMessages(prev => [...prev, {text: message.message, isOwn: false}]);
                    appendLog('Received chat message: ' + message.message);
                    break;
            }
        } catch (error) {
            // Fallback for non-JSON messages (backward compatibility)
            setChatMessages(prev => [...prev, {text: msg, isOwn: false}]);
            appendLog('Received message: ' + msg);
        }
    }

    async function sendMessage() {
        const msg = messageInput().trim();
        if (!msg) return;

        // Add to local chat immediately
        setChatMessages(prev => [...prev, {text: msg, isOwn: true}]);
        setMessageInput('');

        // Send via new message system
        sendChatMessage(msg);
    }

    async function requestMediaPermissions(): Promise<MediaStream | null> {
        try {
            appendLog('Requesting media permissions...');
            
            const constraints = {
                video: {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    facingMode: 'user'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setLocalStream(stream);
            appendLog('Media permissions granted');
            
            setupVideoElement(VIDEO_SELECTORS.LOCAL_PIP, stream);
            
            return stream;
        } catch (error) {
            const errorMessage = String(error);
            appendLog('Media permissions denied: ' + errorMessage);
            
            if (errorMessage.includes('NotAllowedError')) {
                appendLog('Please allow camera and microphone access');
            } else if (errorMessage.includes('NotFoundError')) {
                appendLog('No camera or microphone found');
            } else if (errorMessage.includes('NotReadableError')) {
                appendLog('Camera or microphone is already in use');
            }
            return null;
        }
    }

    async function startCall() {
        if (connectionStatus() !== 'connected') {
            appendLog('Cannot start call - no active connection');
            return;
        }

        if (isInCall() || callStatus() !== 'idle') {
            appendLog('Call already in progress or not ready');
            return;
        }

        try {
            setCallStatus('calling');
            appendLog('Initiating call...');

            // Send call request over data channel
            sendDataMessage({ type: 'call-request', from: 'me' } as CallMessage);
            appendLog('Call request sent');
            
        } catch (error) {
            resetCallState();
            appendLog('Failed to start call: ' + String(error));
        }
    }

    function toggleAudioMute() {
        const local = localStream();
        if (local) {
            const audioTracks = local.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsAudioMuted(!isAudioMuted());
            appendLog(`Audio ${!isAudioMuted() ? 'muted' : 'unmuted'}`);
        }
    }

    function toggleVideoMute() {
        const local = localStream();
        if (local) {
            const videoTracks = local.getVideoTracks();
            videoTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsVideoMuted(!isVideoMuted());
            appendLog(`Video ${!isVideoMuted() ? 'muted' : 'unmuted'}`);
        }
    }

    async function endCall(): Promise<void> {
        try {
            setCallStatus('ending');
            appendLog('Ending call...');

            if (isInCall()) {
                sendDataMessage({ type: 'call-end', from: 'me' });
            }

            const local = localStream();
            if (local) {
                local.getTracks().forEach(track => track.stop());
                setLocalStream(null);
            }

            setRemoteStream(null);
            setIncomingCall(null);
            setIsAudioMuted(false);
            setIsVideoMuted(false);
            resetCallState();

            pc?.getSenders().forEach(sender => {
                if (sender.track) pc!.removeTrack(sender);
            });
            appendLog('Media tracks removed');

            appendLog('Call ended');
        } catch (error) {
            resetCallState();
            appendLog('Error ending call: ' + String(error));
        }
    }

    async function createOffer(): Promise<void> {
        const connection = createPeerConnectionWithStatus(onDataMessage);
        dataChannel = connection.createDataChannel('chat');
        appendLog('Data channel created');
        
        dataChannel.onmessage = (e) => onDataMessage(e.data);
        dataChannel.onopen = () => appendLog('Data channel opened');
        dataChannel.onclose = () => appendLog('Data channel closed');
        dataChannel.onerror = (e) => appendLog('Data channel error: ' + String(e));

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Offer created');
    }

    async function createAnswerFromRemote(remote: RTCSessionDescriptionInit): Promise<void> {
        const connection = createPeerConnectionWithStatus(onDataMessage);
        
        const isVideoCall = remote.sdp?.includes('m=video');
        if (isVideoCall) {
            appendLog('Video call detected');
        }
        
        await connection.setRemoteDescription(remote);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Answer created');
        
        
    }

    async function applyRemoteSDP(): Promise<void> {
        try {
            const parsed: RTCSessionDescriptionInit = JSON.parse(remoteSDP());
            appendLog(`Processing remote SDP: ${parsed.type}`);
            
            if (parsed.type === 'offer') {
                await createAnswerFromRemote(parsed);
            } else {
                if (!pc) createPeerConnectionWithStatus(onDataMessage);
                await pc!.setRemoteDescription(parsed);
                appendLog('Remote answer applied');
                
                if (isInCall()) {
                    appendLog('Call SDP exchange completed');
                    setCallStatus('active');
                }
            }
        } catch (e) {
            appendLog('Invalid remote SDP: ' + String(e));
        }
    }

    onCleanup(() => {
        pc?.close();
    });

    onMount(() => {
        appendLog('Application ready');
        
        const handleUserInteraction = () => {
            ensureVideoPlaying(VIDEO_SELECTORS.REMOTE_FULLSCREEN);
            ensureVideoPlaying(VIDEO_SELECTORS.LOCAL_PIP);
        };
        
        ['click', 'keydown', 'touchstart', 'mousedown'].forEach(eventType => {
            document.addEventListener(eventType, handleUserInteraction, { once: true, passive: true });
        });
    });

    createEffect(() => {
        if (log().length > 0) {
            const logsContainer = document.getElementById('logs-container');
            if (logsContainer) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        }
    });

    createEffect(() => {
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    });

    createEffect(() => {
        const remoteVideo = document.querySelector(VIDEO_SELECTORS.REMOTE_FULLSCREEN) as HTMLVideoElement;
        const remote = remoteStream();
        if (remoteVideo && remote) {
            remoteVideo.srcObject = remote;
            setupVideoElement(VIDEO_SELECTORS.REMOTE_FULLSCREEN);
        }

        const localVideo = document.querySelector(VIDEO_SELECTORS.LOCAL_PIP) as HTMLVideoElement;
        const local = localStream();
        if (localVideo && local) {
            localVideo.srcObject = local;
            localVideo.muted = true;
            setupVideoElement(VIDEO_SELECTORS.LOCAL_PIP);
        }
    });

    

    return (
        <div class={`relative w-full h-screen overflow-hidden transition-colors duration-300 ${isInCall() ? 'bg-black' : 'bg-gray-50'}`}>

            {isInCall() && (
                <VideoCall
                    localStream={localStream}
                    remoteStream={remoteStream}
                    isVideoMuted={isVideoMuted}
                    isAudioMuted={isAudioMuted}
                    connectionStatus={connectionStatus}
                    toggleAudioMute={toggleAudioMute}
                    toggleVideoMute={toggleVideoMute}
                    endCall={endCall}
                />
            )}
            {incomingCall() && (
                <IncomingCall
                    onAccept={() => {
                        setIncomingCall(null);
                        sendDataMessage({ type: 'call-accept', from: 'me' } as CallMessage);
                    }}
                    onDecline={() => {
                        setIncomingCall(null);
                        sendDataMessage({ type: 'call-decline', from: 'me' } as CallMessage);
                    }}
                />
            )}

            {connectionStatus() === 'connected' && (
                <Messages
                    chatMessages={chatMessages}
                    messageInput={messageInput}
                    connectionStatus={connectionStatus}
                    callStatus={callStatus}
                    isInCall={isInCall}
                    localStream={localStream}
                    remoteStream={remoteStream}
                    isVideoMuted={isVideoMuted}
                    onMessageInput={(value) => setMessageInput(value)}
                    onSendMessage={sendMessage}
                    onStartCall={startCall}
                    onEndCall={endCall}
                />
            )}

            <Logs log={log} />

            {connectionStatus() !== 'connected' && (
                <SDPExchange
                    localSDP={localSDP}
                remoteSDP={remoteSDP}
                copied={copied}
                onCreateOffer={createOffer}
                onCopyLocalSDP={copyLocalSDP}
                onRemoteSDPChange={setRemoteSDP}
                onApplyRemoteSDP={applyRemoteSDP}
                onAutoPaste={async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text && text.trim()) {
                            setRemoteSDP(text);
                            appendLog('Remote SDP auto-pasted from clipboard');
                        }
                    } catch (e) {
                        appendLog('Auto-paste failed: ' + String(e));
                    }
                }}
                appendLog={appendLog}
                />
            )}
        </div>
    );
}
