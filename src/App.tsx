import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';

type CallMessage = 
    | { type: 'call-request'; from: string }
    | { type: 'call-accept'; from: string }
    | { type: 'call-decline'; from: string }
    | { type: 'call-offer'; sdp: RTCSessionDescriptionInit }
    | { type: 'call-answer'; sdp: RTCSessionDescriptionInit }
    | { type: 'call-end'; from: string }
    | { type: 'chat'; message: string };

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
    const [showSDPModal, setShowSDPModal] = createSignal(true);
    const [copied, setCopied] = createSignal(false);
    const [log, setLog] = createSignal<string[]>([]);
    const [connectionStatus, setConnectionStatus] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');

    const [showChatWindow, setShowChatWindow] = createSignal(false);
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

    function attemptVideoPlay(selector: string, stream?: MediaStream): void {
        setTimeout(() => {
            const video = document.querySelector(selector) as HTMLVideoElement;
            if (video) {
                if (stream) video.srcObject = stream;
                video.play().catch(err => console.log(`Video play failed for ${selector}:`, err));
            }
        }, 100);
    }

    function createPeerConnectionWithStatus(onDataMessage: (msg: string) => void): RTCPeerConnection {
        if (pc) return pc;
        
        pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

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
                setShowSDPModal(false);
                setConnectionStatus('connected');
                setShowChatWindow(true);
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
                attemptVideoPlay('#remote-video-fullscreen', event.streams[0]);
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





    async function handleSettingsClick() {
        try {
            setShowSDPModal(true);
            appendLog('Opened SDP Exchange modal');
        } catch (e) {
            appendLog('Modal open error: ' + String(e));
        }
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
    }



    function sendCallMessage(message: CallMessage) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            appendLog('Cannot send call message - data channel not ready');
            return;
        }
        
        try {
            dataChannel.send(JSON.stringify(message));
            appendLog(`Sent ${message.type} message`);
        } catch (error) {
            appendLog('Failed to send call message: ' + String(error));
        }
    }

    function sendChatMessage(text: string) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            appendLog('Cannot send chat message - data channel not ready');
            return;
        }
        
        try {
            const message: CallMessage = { type: 'chat', message: text };
            dataChannel.send(JSON.stringify(message));
            appendLog('Sent chat message: ' + text);
        } catch (error) {
            appendLog('Failed to send chat message: ' + String(error));
        }
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
                sendCallMessage({ type: 'call-decline', from: 'me' });
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
                
                sendCallMessage({ type: 'call-offer', sdp: offer });
                
                attemptVideoPlay('#remote-video-fullscreen');
                attemptVideoPlay('#local-video-pip');
            } else {
                appendLog('No active connection for call');
                setCallStatus('idle');
            }
        } catch (error) {
            setCallStatus('idle');
            appendLog('Failed to start media: ' + String(error));
        }
    }

    function handleCallAccept() {
        appendLog('Call accepted by remote peer');
        if (callStatus() === 'calling') {
            // Start the media and send offer
            startMediaAndSendOffer();
        }
    }

    function handleCallDecline() {
        appendLog('Call declined by remote peer');
        setCallStatus('idle');
        setIsInCall(false);
    }

    async function handleCallOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
        try {
            appendLog('Received call offer');
            
            const stream = await requestMediaPermissions();
            if (!stream) {
                sendCallMessage({ type: 'call-decline', from: 'me' });
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
            
            sendCallMessage({ type: 'call-answer', sdp: answer });
            
            setIsInCall(true);
            setCallStatus('active');
            appendLog('Call established');
            
            attemptVideoPlay('#remote-video-fullscreen');
            attemptVideoPlay('#local-video-pip');
            
        } catch (error) {
            appendLog('Failed to handle call offer: ' + String(error));
            sendCallMessage({ type: 'call-decline', from: 'me' });
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
            
            attemptVideoPlay('#remote-video-fullscreen');
            attemptVideoPlay('#local-video-pip');
            
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
                default:
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
            
            attemptVideoPlay('#local-video-pip', stream);
            
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
            sendCallMessage({ type: 'call-request', from: 'me' } as CallMessage);
            appendLog('Call request sent');
            
        } catch (error) {
            setCallStatus('idle');
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
                sendCallMessage({ type: 'call-end', from: 'me' });
            }

            const local = localStream();
            if (local) {
                local.getTracks().forEach(track => track.stop());
                setLocalStream(null);
            }

            setRemoteStream(null);
            setIsInCall(false);
            setCallStatus('idle');
            setIncomingCall(null);
            setIsAudioMuted(false);
            setIsVideoMuted(false);

            if (pc) {
                pc.getSenders().forEach(sender => {
                    if (sender.track) pc!.removeTrack(sender);
                });
                appendLog('Media tracks removed');
            }

            appendLog('Call ended');
        } catch (error) {
            setCallStatus('idle');
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
        
        setShowSDPModal(true);
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
        if (pc) pc.close();
    });

    onMount(() => {
        appendLog('Application ready');
        
        const handleUserInteraction = () => {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                if (video.srcObject && (video as HTMLVideoElement).paused) {
                    (video as HTMLVideoElement).muted = true;
                    (video as HTMLVideoElement).play().catch(() => {});
                }
            });
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
        if (showChatWindow()) {
            const chatContainer = document.getElementById('chat-messages');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
    });

    createEffect(() => {
        const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
        if (remoteVideo && remoteStream()) {
            remoteVideo.srcObject = remoteStream();
            attemptVideoPlay('#remote-video-fullscreen');
        }
    });

    createEffect(() => {
        const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
        if (localVideo && localStream()) {
            localVideo.srcObject = localStream();
            localVideo.muted = true;
            attemptVideoPlay('#local-video-pip');
        }
    });

    const [logsPos, setLogsPos] = createSignal({ x: window.innerWidth - 400, y: 40 });
    const [dragging, setDragging] = createSignal(false);
    const dragOffset = { x: 0, y: 0 };

    function onLogsPointerDown(e: PointerEvent): void {
        setDragging(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        (e.target as Element)?.setPointerCapture?.((e as any).pointerId);
        e.stopPropagation();
    }

    function onLogsPointerMove(e: PointerEvent): void {
        if (!dragging()) return;
        
        const maxX = window.innerWidth - 360;
        const newX = Math.max(0, Math.min(maxX, e.clientX - dragOffset.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 320, e.clientY - dragOffset.y));
        
        setLogsPos({ x: newX, y: newY });
    }

    function onLogsPointerUp(): void {
        setDragging(false);
    }

    window.addEventListener('pointermove', onLogsPointerMove as any);
    window.addEventListener('pointerup', onLogsPointerUp as any);
    onCleanup(() => {
        window.removeEventListener('pointermove', onLogsPointerMove as any);
        window.removeEventListener('pointerup', onLogsPointerUp as any);
    });



    return (
        <div class={`relative w-full h-screen overflow-hidden transition-colors duration-300 ${isInCall() ? 'bg-black' : 'bg-gray-50'}`}>

            {/* Full Screen Video Call Overlay */}
            {isInCall() && (
                <div class="fixed inset-0 z-50 bg-black">
                    <video 
                        id="remote-video-fullscreen"
                        class="absolute inset-0 w-full h-full object-cover"
                        autoplay
                        playsinline
                        muted={false}
                        controls={false}
                        disablepictureinpicture
                    />
                    
                    {!remoteStream() && (
                        <div class="absolute inset-0 flex items-center justify-center bg-gray-900">
                            <div class="text-white text-xl">
                                {callStatus() === 'connecting' ? 'Connecting...' : 'Waiting for remote video...'}
                            </div>
                        </div>
                    )}
                    {localStream() && (
                        <div class="absolute top-4 right-4 w-48 bg-black/80 backdrop-blur-sm rounded-2xl overflow-hidden shadow-2xl border border-white/10" style="aspect-ratio: auto;">
                            {isVideoMuted() ? (
                                <div class="w-full h-full flex items-center justify-center bg-gray-900/90 backdrop-blur-sm">
                                    <div class="text-white/80 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                        </svg>
                                        <div class="text-xs">Camera Off</div>
                                    </div>
                                </div>
                            ) : (
                                <video 
                                    id="local-video-pip"
                                    class="w-full h-full object-cover"
                                    autoplay
                                    muted
                                    playsinline
                                    controls={false}
                                />
                            )}
                        </div>
                    )}
                    <div class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-6">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <div class="font-medium text-white">Chat</div>
                                <div class="flex items-center gap-1">
                                    {connectionStatus() === 'connected' ? (
                                        <div class="w-2 h-2 bg-green-500 rounded-full" title="Connected" />
                                    ) : connectionStatus() === 'connecting' ? (
                                        <div class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" title="Connecting" />
                                    ) : (
                                        <div class="w-2 h-2 bg-gray-400 rounded-full" title="Disconnected" />
                                    )}

                                </div>
                            </div>

                        </div>
                    </div>
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-6">
                        <div class="flex items-center justify-center gap-6">
                            <button
                                onClick={toggleAudioMute}
                                class={`w-14 h-14 rounded-full backdrop-blur-sm flex items-center justify-center text-white transition-all transform hover:scale-105 ${
                                    isAudioMuted() 
                                        ? 'bg-red-500/80 hover:bg-red-500' 
                                        : 'bg-white/20 hover:bg-white/30'
                                }`}
                                title={isAudioMuted() ? "Unmute microphone" : "Mute microphone"}
                            >
                                {isAudioMuted() ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    </svg>
                                )}
                            </button>
                            
                            <button
                                onClick={endCall}
                                class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-all transform hover:scale-105 shadow-xl"
                                title="End call"
                            >
                                <div class="w-8 h-8 bg-white rounded-sm"></div>
                            </button>
                            
                            <button
                                onClick={toggleVideoMute}
                                class={`w-14 h-14 rounded-full backdrop-blur-sm flex items-center justify-center text-white transition-all transform hover:scale-105 ${
                                    isVideoMuted() 
                                        ? 'bg-red-500/80 hover:bg-red-500' 
                                        : 'bg-white/20 hover:bg-white/30'
                                }`}
                                title={isVideoMuted() ? "Turn on camera" : "Turn off camera"}
                            >
                                {isVideoMuted() ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {incomingCall() && (
                <div class="fixed inset-0 z-40 flex items-center justify-center" style={{ 'background-color': 'rgba(0, 0, 0, 0.3)' }}>
                    <div class="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <div class="text-center mb-4">
                            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h3 class="text-lg font-semibold mb-1">Incoming Video Call</h3>
                            <p class="text-gray-600">{incomingCall()!.from} is calling you</p>
                        </div>
                        
                        <div class="flex gap-3 justify-center">
                            <button
                                onClick={() => {
                                    setIncomingCall(null);
                                    sendCallMessage({ type: 'call-accept', from: 'me' } as CallMessage);
                                }}
                                class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                                Accept
                            </button>
                            <button
                                onClick={() => {
                                    setIncomingCall(null);
                                    sendCallMessage({ type: 'call-decline', from: 'me' } as CallMessage);
                                }}
                                class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Decline
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Window */}
            {showChatWindow() && (
                <div class={`fixed bg-gray-900 shadow-lg z-30 flex flex-col transition-all duration-300 ${
                    isInCall() 
                        ? 'bottom-4 right-4 w-80 h-[600px] rounded-2xl' 
                        : 'inset-0 rounded-none'
                }`}>
                    <div class={`px-4 py-3 flex items-center justify-between bg-gray-800/90 backdrop-blur-lg ${isInCall() ? 'rounded-t-2xl' : 'rounded-t-2xl'}`}>
                        <div class="flex items-center gap-2">
                            <div class="font-medium text-white">Chat</div>
                            <div class="flex items-center gap-1">
                                {connectionStatus() === 'connected' ? (
                                    <div class="w-2 h-2 bg-green-500 rounded-full" title="Connected" />
                                ) : connectionStatus() === 'connecting' ? (
                                    <div class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" title="Connecting" />
                                ) : (
                                    <div class="w-2 h-2 bg-gray-400 rounded-full" title="Disconnected" />
                                )}

                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            {!isInCall() ? (
                                <button
                                    class={`p-2 rounded-full backdrop-blur-sm transition-all duration-200 hover:scale-110 ${
                                        connectionStatus() === 'connected' && callStatus() === 'idle'
                                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                            : callStatus() === 'calling'
                                            ? 'bg-yellow-500/20 text-yellow-400 animate-pulse'
                                            : 'bg-gray-500/20 text-gray-400 cursor-not-allowed'
                                    }`}
                                    onClick={startCall}
                                    disabled={connectionStatus() !== 'connected' || callStatus() !== 'idle'}
                                    title={connectionStatus() !== 'connected' ? 'No connection' : callStatus() === 'calling' ? 'Calling...' : callStatus() === 'idle' ? 'Start video call' : 'Call in progress...'}
                                >
                                    {callStatus() === 'calling' ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    )}
                                </button>
                            ) : (
                                <button
                                    class="p-2 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 backdrop-blur-sm transition-all duration-200 hover:scale-110"
                                    onClick={endCall}
                                    title="End call"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                                    </svg>
                                </button>
                            )}

                        </div>
                    </div>
                    
                    {/* Video Call Area */}
                    {isInCall() && (
                        <div class="border-t border-gray-700/50 bg-gray-800/50 backdrop-blur-sm">
                            {callStatus() === 'connecting' && (
                                <div class="bg-blue-600/80 backdrop-blur-sm text-white text-xs px-3 py-2 text-center border border-blue-500/30">
                                    Copy the SDP from the modal and send it to the remote peer
                                </div>
                            )}
                            <div class="relative h-48">
                                {/* Remote Video (full size) */}
                                <video 
                                    class="w-full h-full object-cover"
                                    autoplay
                                    playsinline
                                />
                                {!remoteStream() && (
                                    <div class="absolute inset-0 flex items-center justify-center bg-gray-800">
                                        <div class="text-white text-sm">
                                            {callStatus() === 'connecting' ? 'Connecting...' : 'Waiting for remote video...'}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Local Video (picture-in-picture) */}
                                {localStream() && (
                                    <div class="absolute bottom-2 right-2 w-24 bg-black/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/10" style="aspect-ratio: auto;">
                                <video 
                                    class="w-full h-full object-contain"
                                    autoplay
                                    muted
                                    playsinline
                                />
                                    </div>
                                )}
                                
                                {/* Call Status Indicator */}
                                <div class="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1 border border-white/10">
                                    <div class={`w-2 h-2 rounded-full ${
                                        callStatus() === 'active' ? 'bg-green-500 animate-pulse' :
                                        callStatus() === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                        'bg-red-500'
                                    }`}></div>
                                    {callStatus() === 'connecting' ? 'Connecting...' : 
                                     callStatus() === 'active' ? 'Live' : 
                                     callStatus() === 'ringing' ? 'Ringing...' : 
                                     'Ready'}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div class={`overflow-y-auto p-4 space-y-2 ${isInCall() ? 'h-32' : 'flex-1 min-h-0'}`} id="chat-messages">
                        {chatMessages().length > 0 ? (
                            chatMessages().map((msg) => (
                                <div 
                                    class={`text-sm ${msg.isOwn ? 'text-right' : 'text-left'}`}
                                >
                                    <span 
                                        class={`inline-block px-3 py-2 rounded-2xl backdrop-blur-sm ${
                                            msg.isOwn 
                                                ? 'bg-blue-600/80 text-white' 
                                                : 'bg-gray-700/60 text-gray-100'
                                        }`}
                                    >
                                        {msg.text}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div class="text-center text-gray-400 text-sm mt-4">
                                No messages yet. Start a conversation!
                            </div>
                        )}
                    </div>
                    
                    <div class={`px-4 py-3 ${isInCall() ? '' : 'rounded-b-2xl'}`}>
                        <div class="flex gap-2">
                            <input 
                                type="text" 
                                class="flex-1 px-4 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent"
                                placeholder="Type a message..."
                                value={messageInput()}
                                onInput={(e: any) => setMessageInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            />
                            <button 
                                class="px-6 py-3 bg-blue-600/80 backdrop-blur-sm text-white rounded-full hover:bg-blue-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105"
                                onClick={sendMessage}
                                disabled={!messageInput().trim() || connectionStatus() !== 'connected'}
                            >
                                Send
                            </button>
                        </div>
                        {connectionStatus() !== 'connected' && (
                            <div class="text-xs text-red-400 mt-1">
                                Connection not ready
                            </div>
                        )}
                        {callStatus() === 'calling' && (
                            <div class="text-xs text-yellow-400 mt-1 animate-pulse">
                                Calling... waiting for response
                            </div>
                        )}
                        {callStatus() === 'ringing' && (
                            <div class="text-xs text-green-400 mt-1 animate-pulse">
                                Incoming call - check call popup
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div
                class="fixed bg-white border rounded shadow z-50"
                style={{ 
                    left: logsPos().x + 'px',
                    top: logsPos().y + 'px', 
                    width: '360px' 
                }}
            >
                <div class="px-3 py-2 bg-gray-100 border-b cursor-grab flex items-center justify-between" onPointerDown={(e:any)=>onLogsPointerDown(e)}>
                    <div class="text-sm font-medium">Logs</div>
                    <div class="text-xs text-gray-600">
                        <button class="px-2 py-1" onClick={() => setLogsPos({ x: window.innerWidth - 400, y: 40 })}>Reset</button>
                    </div>
                </div>
                <div class="h-80 p-2 overflow-auto" id="logs-container">
                    {log().map((l) => (
                        <div class="text-xs text-gray-700">{l}</div>
                    ))}
                </div>
            </div>

            {showSDPModal() && (
                <div class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900">
                    <div class="w-full h-full p-6 overflow-auto">
                        <div class="mb-2">
                            <h2 class="text-lg font-semibold text-gray-100">
                                {isInCall() ? 'Video Call - SDP Exchange' : 'SDP Exchange'}
                            </h2>
                        </div>
                        
                        {isInCall() && (
                            <div class="mb-4 p-3 bg-green-900/30 border border-green-700 rounded-lg">
                                <div class="text-sm text-green-300">
                                    Video Call in Progress: SDP exchange is automatic via data channel
                                </div>
                            </div>
                        )}
                        
                        {/* Local SDP Display */}
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <label class="block text-sm font-medium text-gray-200">Local SDP</label>
                                <button 
                                    class="px-3 py-1 bg-green-600 text-white rounded disabled:bg-gray-600 hover:bg-green-700 transition-colors" 
                                    onClick={async () => {
                                        try {
                                            await createOffer();
                                            appendLog('Local SDP created');
                                        } catch (e) {
                                            appendLog('Failed to create offer: ' + String(e));
                                        }
                                    }}
                                    disabled={isInCall()}
                                >
                                    {isInCall() ? 'Call in Progress' : 'Create Offer'}
                                </button>
                            </div>
                            <div class="flex gap-2">
                                <textarea class="flex-1 h-64 p-2 border border-gray-600 rounded bg-gray-800 text-gray-100 font-mono text-sm" value={localSDP()} readonly />
                                <button class="px-3 py-1 bg-indigo-600 text-white rounded self-start hover:bg-indigo-700 transition-colors" onClick={copyLocalSDP}>{copied() ? 'Copied' : 'Copy'}</button>
                            </div>
                        </div>





                        {/* Remote SDP Input */}
                        <div class="mb-4">
                            <label class="block text-sm font-medium mb-2 text-gray-200">Remote SDP</label>
                            <textarea 
                                class="w-full h-32 p-2 border border-gray-600 rounded mb-2 bg-gray-800 text-gray-100 font-mono text-sm placeholder-gray-400" 
                                placeholder="Paste remote SDP here... (Click to auto-paste)"
                                value={remoteSDP()}
                                onInput={(e: any) => setRemoteSDP(e.target.value)}
                                onClick={async () => {
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
                            />
                            <button 
                                class="px-3 py-1 bg-green-600 text-white rounded mr-2 hover:bg-green-700 transition-colors" 
                                onClick={async () => {
                                    if (remoteSDP()) {
                                        await applyRemoteSDP();
                                        appendLog('Remote SDP applied');
                                    }
                                }}
                            >
                                Set Remote SDP
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}
