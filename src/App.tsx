import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import { version } from 'vite';

type SDPString = string;

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





async function waitForIceGatheringComplete(pc: RTCPeerConnection) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
        function check() {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve(true);
            }
        }
        pc.addEventListener('icegatheringstatechange', check);
    });
}

export default function App() {
    const [localSDP, setLocalSDP] = createSignal<SDPString>('');
    const [remoteSDP, setRemoteSDP] = createSignal<SDPString>('');
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




    function appendLog(s: string) {
        setLog((l) => [...l, s]);
        console.log(s);
    }

    function createPeerConnectionWithStatus(onDataMessage: (msg: string) => void) {
        if (pc) return pc;
        pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        // Log initial state
        appendLog(`RTCPeerConnection created - initial state: ${pc.connectionState}, ICE: ${pc.iceConnectionState}, gathering: ${pc.iceGatheringState}`);



        pc.ondatachannel = (ev) => {
            appendLog(`ondatachannel: received data channel ${ev.channel.label}, state: ${ev.channel.readyState}`);
            dataChannel = ev.channel;
            dataChannel.onmessage = (e) => onDataMessage(e.data);
            dataChannel.onopen = () => {
                appendLog('Data channel open - connection established');
            };
            dataChannel.onclose = () => {
                appendLog('Data channel closed');
            };
            dataChannel.onerror = (e) => {
                appendLog('Data channel error: ' + String(e));
            };
        };

        pc.onconnectionstatechange = async () => {
            const state = pc?.connectionState;
            appendLog(`onconnectionstatechange: ${state}`);
            if (state === 'connected') {
                setShowSDPModal(false);
                setConnectionStatus('connected');
                setShowChatWindow(true); // Show chat window when connected
                
                // Ensure both sides are ready for video exchange
                appendLog('Peer connection established - ready for video track exchange');
                
                // Safari specific: Trigger video play when connection is fully established
                setTimeout(() => {
                    const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
                    const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
                    
                    [remoteVideo, localVideo].forEach(video => {
                        if (video && video.srcObject && (video as HTMLVideoElement).paused) {
                            (video as HTMLVideoElement).play().catch(err => {
                                console.log('Connection state video play failed:', err);
                            });
                        }
                    });
                }, 1000);
                
                // Connection established
                setLocalSDP('');
                setRemoteSDP('');
                appendLog('Connection established');
            } else if (state === 'disconnected' || state === 'failed') {
                setConnectionStatus('disconnected');
                if (isInCall()) {
                    endCall();
                }
            }
        };

        pc.ontrack = (event) => {
            appendLog(`ontrack: received ${event.track.kind} track from remote peer`);
            if (event.streams[0]) {
                setRemoteStream(event.streams[0]);
                appendLog('Remote stream set - this should now play on the caller');
                
                // Safari specific: Force video to play after receiving track
                setTimeout(() => {
                    const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
                    if (remoteVideo) {
                        remoteVideo.srcObject = event.streams[0];
                        remoteVideo.play().then(() => {
                            console.log('Remote video playing successfully after ontrack');
                        }).catch(err => {
                            console.log('Safari ontrack video play failed:', err);
                            // Try with user gesture
                            const attemptPlayWithGesture = () => {
                                remoteVideo.play().catch(e => console.log('Gesture play failed:', e));
                            };
                            document.addEventListener('click', attemptPlayWithGesture, { once: true });
                        });
                    }
                }, 100);
            }
        };

        pc.oniceconnectionstatechange = () => {
            appendLog(`oniceconnectionstatechange: ${pc?.iceConnectionState}`);
        };

        pc.onicegatheringstatechange = () => {
            appendLog(`onicegatheringstatechange: ${pc?.iceGatheringState}`);
        };

        pc.onsignalingstatechange = () => {
            appendLog(`onsignalingstatechange: ${pc?.signalingState}`);
        };

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                appendLog(`onicecandidate: ${ev.candidate.type} candidate for ${ev.candidate.address || 'unknown'} (${ev.candidate.protocol})`);
            } else {
                appendLog('onicecandidate: ICE gathering complete (null candidate)');
            }
        };

        pc.onicecandidateerror = (ev) => {
            appendLog(`onicecandidateerror: ${ev.errorText} (address: ${ev.address}, port: ${ev.port})`);
        };

        pc.onnegotiationneeded = async () => {
            appendLog('onnegotiationneeded: renegotiation required');
            // Don't automatically renegotiate here as we handle it manually in call flow
            // This prevents conflicts with our explicit offer/answer handling
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

    async function startMediaAndSendOffer() {
        try {
            setCallStatus('connecting');
            appendLog('Getting media for call...');

            const stream = await requestMediaPermissions();
            if (!stream) {
                sendCallMessage({ type: 'call-decline', from: 'me' } as CallMessage);
                return;
            }

            if (pc && pc.connectionState === 'connected') {
                // Add tracks first
                stream.getTracks().forEach(track => {
                    pc!.addTrack(track, stream);
                });
                
                setIsInCall(true);
                appendLog('Media tracks added to peer connection');
                
                // Wait a bit for tracks to be fully added before creating offer
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                appendLog('Call offer created');
                
                // Send the offer over data channel
                sendCallMessage({ type: 'call-offer', sdp: offer } as CallMessage);
                
                // Safari specific: Force video elements to play after adding tracks
                setTimeout(() => {
                    const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
                    const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
                    
                    if (remoteVideo && remoteVideo.srcObject) {
                        remoteVideo.play().catch(err => console.log('Safari remote video play failed:', err));
                    }
                    if (localVideo && localVideo.srcObject) {
                        localVideo.play().catch(err => console.log('Safari local video play failed:', err));
                    }
                }, 500);
            } else {
                appendLog('No active peer connection for call');
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

    async function handleCallOffer(sdp: RTCSessionDescriptionInit) {
        try {
            appendLog('Received call offer');
            
            // Get media permissions for incoming call
            const stream = await requestMediaPermissions();
            if (!stream) {
                sendCallMessage({ type: 'call-decline', from: 'me' } as CallMessage);
                return;
            }
            
            if (!pc) {
                createPeerConnectionWithStatus(onDataMessage);
            }
            
            // Add local media tracks BEFORE creating answer
            stream.getTracks().forEach(track => {
                pc!.addTrack(track, stream);
            });
            appendLog('Local media tracks added to peer connection');
            
            // Set remote offer and create answer
            await pc!.setRemoteDescription(sdp);
            appendLog('Remote offer set');
            
            const answer = await pc!.createAnswer();
            await pc!.setLocalDescription(answer);
            appendLog('Answer created');
            
            // Send answer back
            sendCallMessage({ type: 'call-answer', sdp: answer });
            
            setIsInCall(true);
            setCallStatus('active');
            appendLog('Call established - sending answer');
            
            // Debug: Log track information
            setTimeout(() => {
                if (pc?.getReceivers) {
                    const receivers = pc.getReceivers();
                    appendLog(`Answer sent - track receivers: ${receivers.length}`);
                }
                if (pc?.getSenders) {
                    const senders = pc.getSenders();
                    appendLog(`Answer sent - track senders: ${senders.length}`);
                }
            }, 500);
            
            // Safari specific: Force video elements to play after connection
            setTimeout(() => {
                const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
                const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
                
                if (remoteVideo && remoteVideo.srcObject) {
                    remoteVideo.play().catch(err => console.log('Safari remote video play failed:', err));
                }
                if (localVideo && localVideo.srcObject) {
                    localVideo.play().catch(err => console.log('Safari local video play failed:', err));
                }
            }, 500);
            
        } catch (error) {
            appendLog('Failed to handle call offer: ' + String(error));
            sendCallMessage({ type: 'call-decline', from: 'me' });
        }
    }

    async     function handleCallAnswer(sdp: RTCSessionDescriptionInit) {
        try {
            appendLog('Received call answer');
            
            if (!pc) {
                appendLog('No peer connection for call answer');
                return;
            }
            
            await pc.setRemoteDescription(sdp);
            setCallStatus('active');
            appendLog('Call established with remote peer');
            
            // Debug: Log current tracks
            if (pc.getReceivers) {
                const receivers = pc.getReceivers();
                appendLog(`Current track receivers: ${receivers.length}`);
                receivers.forEach(receiver => {
                    appendLog(`- Receiver track: ${receiver.track.kind} (enabled: ${receiver.track.enabled}, state: ${receiver.track.readyState})`);
                });
            }
            
            // Safari specific: Force video elements to play after connection
            setTimeout(() => {
                const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
                const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
                
                if (remoteVideo && remoteVideo.srcObject) {
                    remoteVideo.play().catch(err => console.log('Safari remote video play failed:', err));
                }
                if (localVideo && localVideo.srcObject) {
                    localVideo.play().catch(err => console.log('Safari local video play failed:', err));
                }
            }, 500);
            
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
            appendLog('Requesting camera and microphone permissions...');
            
            // Safari-specific constraints for better compatibility
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
            appendLog('Media permissions granted successfully');
            
            // Safari specific: Force local video to play after getting stream
            setTimeout(() => {
                const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.muted = true; // Ensure muted for Safari autoplay
                    localVideo.play().then(() => {
                        console.log('Local video playing after media permissions');
                    }).catch(err => {
                        console.log('Local video play after permissions failed:', err);
                    });
                }
            }, 100);
            
            return stream;
        } catch (error) {
            const errorMessage = String(error);
            appendLog('Media permissions denied: ' + errorMessage);
            
            if (errorMessage.includes('NotAllowedError')) {
                appendLog('Please allow camera and microphone access in your browser settings');
            } else if (errorMessage.includes('NotFoundError')) {
                appendLog('No camera or microphone found. Please connect a device.');
            } else if (errorMessage.includes('NotReadableError')) {
                appendLog('Camera or microphone is already in use by another application');
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

    async function endCall() {
        try {
            setCallStatus('ending');
            appendLog('Ending call...');

            // Send call end message
            if (isInCall()) {
                sendCallMessage({ type: 'call-end', from: 'me' } as CallMessage);
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
                const senders = pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track) {
                        pc!.removeTrack(sender);
                    }
                });
                appendLog('Media tracks removed from peer connection');
            }

            appendLog('Call ended');
        } catch (error) {
            setCallStatus('idle');
            appendLog('Error ending call: ' + String(error));
        }
    }



    async function createOffer() {
        const connection = createPeerConnectionWithStatus(onDataMessage);
        dataChannel = connection.createDataChannel('chat');
        appendLog(`createDataChannel: created data channel 'chat', state: ${dataChannel.readyState}`);
        
        dataChannel.onmessage = (e) => onDataMessage(e.data);
        dataChannel.onopen = () => appendLog('Data channel opened (offerer)');
        dataChannel.onclose = () => appendLog('Data channel closed (offerer)');
        dataChannel.onerror = (e) => appendLog('Data channel error (offerer): ' + String(e));

        const offer = await connection.createOffer();
        appendLog(`createOffer: offer created, type: ${offer.type}`);
        await connection.setLocalDescription(offer);
        appendLog('setLocalDescription: offer set as local description');
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Offer created with data channel and ICE candidates');
    }

    async function createAnswerFromRemote(remote: RTCSessionDescriptionInit) {
        const connection = createPeerConnectionWithStatus(onDataMessage);
        
        appendLog(`createAnswerFromRemote: processing remote ${remote.type}`);
        
        // Check if this is a video call offer
        const isVideoCall = remote.sdp && remote.sdp.includes('m=video');
        if (isVideoCall) {
            appendLog('Video call detected - preparing to receive media');
        }
        
        await connection.setRemoteDescription(remote);
        appendLog('setRemoteDescription: remote offer set');
        const answer = await connection.createAnswer();
        appendLog(`createAnswer: answer created, type: ${answer.type}`);
        await connection.setLocalDescription(answer);
        appendLog('setLocalDescription: answer set as local description');
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Answer created with data channel and ICE candidates');
        
        // Show SDP modal for the user to copy the answer
        setShowSDPModal(true);
        
        if (isVideoCall) {
            appendLog('Please copy the answer SDP and send it back to establish the video call');
        }
    }

    async function applyRemoteSDP() {
        try {
            const parsed: RTCSessionDescriptionInit = JSON.parse(remoteSDP());
            appendLog(`applyRemoteSDP: parsing remote SDP of type ${parsed.type}`);
            
            // If we received an offer, create answer
            if (parsed.type === 'offer') {
                await createAnswerFromRemote(parsed);
                
                // If this is a call offer, automatically start our media
                if (parsed.sdp && parsed.sdp.includes('m=video')) {
                    appendLog('Detected video call offer - preparing media...');
                    // Don't automatically start media, let the user click the call button
                }
            } else {
                // answer
                appendLog('applyRemoteSDP: processing remote answer');
                if (!pc) createPeerConnectionWithStatus(onDataMessage);
                
                await pc!.setRemoteDescription(parsed);
                appendLog('setRemoteDescription: remote answer applied successfully');
                
                // If we're in a call and just received the answer, the connection should be ready
                if (isInCall()) {
                    appendLog('Call SDP exchange completed - media connection established');
                    setCallStatus('active');
                }
            }
        } catch (e) {
            appendLog('Invalid remote SDP: ' + String(e));
        }
    }

    // sendMessage removed (chat UI removed)

    onCleanup(() => {
        if (pc) pc.close();
    });

    onMount(() => {
        // No connections to load from storage since we're using in-memory only
        appendLog('Application ready - connections will be created when WebRTC connections are established');
        
        // Safari specific: Enhanced user interaction handling
        const handleUserInteraction = (event: Event) => {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                if (video.srcObject && (video as HTMLVideoElement).paused) {
                    (video as HTMLVideoElement).play().then(() => {
                        console.log('Video playing after user interaction');
                    }).catch(err => {
                        console.log('Video play after interaction failed:', err);
                        // Try to unmute if that's the issue
                        (video as HTMLVideoElement).muted = true;
                        (video as HTMLVideoElement).play().catch(e => console.log('Muted play failed:', e));
                    });
                }
            });
            
            // Safari specific: Special handling for local video
            const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
            if (localVideo && localVideo.srcObject && localVideo.paused) {
                localVideo.muted = true; // Ensure muted for autoplay
                localVideo.play().then(() => {
                    console.log('Local video playing after user interaction');
                }).catch(err => {
                    console.log('Local video interaction play failed:', err);
                });
            }
        };
        
        // Add multiple interaction listeners for Safari autoplay
        const events = ['click', 'keydown', 'touchstart', 'mousedown'];
        events.forEach(eventType => {
            document.addEventListener(eventType, handleUserInteraction, { once: true, passive: true });
        });
        
        // Safari specific: Add continuous interaction handling
        const continuousHandler = () => {
            if (remoteStream() || localStream()) {
                const videos = document.querySelectorAll('video');
                videos.forEach(video => {
                    if (video.srcObject && (video as HTMLVideoElement).paused) {
                        (video as HTMLVideoElement).play().catch(() => {});
                    }
                });
            }
        };
        document.addEventListener('click', continuousHandler, { passive: true });
    });

    // Auto-scroll logs and chat to bottom when new content is added
    createEffect(() => {
        const logsCount = log().length;
        if (logsCount > 0) {
            setTimeout(() => {
                const logsContainer = document.getElementById('logs-container');
                if (logsContainer) {
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                }
            }, 0);
        }
    });

    createEffect(() => {
        if (showChatWindow()) {
            setTimeout(() => {
                const chatContainer = document.getElementById('chat-messages');
                if (chatContainer) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }, 0);
        }
    });

    // Reactive effects for video streams
    createEffect(() => {
        // Update remote video element
        const remoteVideo = document.querySelector('#remote-video-fullscreen') as HTMLVideoElement;
        if (remoteVideo && remoteStream()) {
            remoteVideo.srcObject = remoteStream();
            
            // Safari specific: ensure video metadata is loaded before playing
            remoteVideo.onloadedmetadata = () => {
                const attemptPlay = (attempts = 0) => {
                    if (attempts >= 8) return;
                    
                    remoteVideo.play().then(() => {
                        console.log('Remote video playing successfully');
                    }).catch(err => {
                        console.log(`Remote video play attempt ${attempts + 1} failed:`, err);
                        setTimeout(() => attemptPlay(attempts + 1), 300 * (attempts + 1));
                    });
                };
                attemptPlay();
            };
            
            // Force metadata load
            remoteVideo.load();
        }
    });

    createEffect(() => {
        // Update local video element
        const localVideo = document.querySelector('#local-video-pip') as HTMLVideoElement;
        if (localVideo && localStream()) {
            localVideo.srcObject = localStream();
            
            // Safari specific: enhanced local video handling
            const handleLocalVideoPlay = () => {
                const attemptPlay = (attempts = 0) => {
                    if (attempts >= 12) return;
                    
                    localVideo.play().then(() => {
                        console.log('Local video playing successfully from effect');
                        
                        // Verify it's actually playing
                        setTimeout(() => {
                            if (localVideo.paused) {
                                console.log('Local video still paused, retrying...');
                                attemptPlay(attempts + 1);
                            }
                        }, 500);
                        
                    }).catch(err => {
                        console.log(`Local video effect play attempt ${attempts + 1} failed:`, err);
                        
                        // Safari specific: try different approaches
                        if (attempts === 3) {
                            // Try with muted explicitly
                            localVideo.muted = true;
                        } else if (attempts === 6) {
                            // Try with user gesture fallback
                            const attemptWithGesture = () => {
                                localVideo.play().catch(e => console.log('Gesture local play failed:', e));
                            };
                            document.addEventListener('click', attemptWithGesture, { once: true });
                        }
                        
                        setTimeout(() => attemptPlay(attempts + 1), 200 * (attempts + 1));
                    });
                };
                attemptPlay();
            };
            
            // Try multiple approaches for Safari
            if (localVideo.readyState >= 2) { // HAVE_CURRENT_DATA
                handleLocalVideoPlay();
            } else {
                localVideo.onloadedmetadata = handleLocalVideoPlay;
                localVideo.load();
            }
        }
    });

    const [logsPos, setLogsPos] = createSignal<{ x: number; y: number }>({ x: window.innerWidth - 400, y: 40 });
    const [dragging, setDragging] = createSignal(false);
    let dragOffset = { x: 0, y: 0 };

    function onLogsPointerDown(e: PointerEvent) {
        setDragging(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        try { (e.target as Element).setPointerCapture?.((e as any).pointerId); } catch {}
        e.stopPropagation();
    }

    function onLogsPointerMove(e: PointerEvent) {
        if (!dragging()) return;
        
        // Calculate right position (distance from right edge)
        const maxX = window.innerWidth - 360; // Maximum x from left
        const minX = 0;
        const newX = Math.min(maxX, Math.max(minX, e.clientX - dragOffset.x));
        
        // Calculate bottom position (distance from bottom edge)
        const maxBottom = window.innerHeight - 100; // Minimum distance from top
        const minBottom = 0; // Minimum distance from bottom
        const newBottom = Math.min(maxBottom, Math.max(minBottom, window.innerHeight - (e.clientY - dragOffset.y + 320)));
        
        setLogsPos({ x: newX, y: newBottom });
    }

    function onLogsPointerUp(e: PointerEvent) {
        setDragging(false);
        try { (e.target as Element).releasePointerCapture?.((e as any).pointerId); } catch {}
    }

    // global listeners for pointer move/up
    window.addEventListener('pointermove', onLogsPointerMove as any);
    window.addEventListener('pointerup', onLogsPointerUp as any);
    onCleanup(() => {
        window.removeEventListener('pointermove', onLogsPointerMove as any);
        window.removeEventListener('pointerup', onLogsPointerUp as any);
    });

    // Chat functions removed - messages logged only

    return (
        <div class={`relative w-full h-screen overflow-hidden transition-colors duration-300 ${isInCall() ? 'bg-black' : 'bg-gray-50'}`}>

            {/* Full Screen Video Call Overlay */}
            {isInCall() && (
                <div class="fixed inset-0 z-50 bg-black">
                    {/* Remote Video (Full Background) */}
                    <video 
                        id="remote-video-fullscreen"
                        ref={(el) => {
                            if (el) {
                                el.srcObject = remoteStream() || null;
                                // Safari specific: better video initialization
                                if (remoteStream()) {
                                    el.load(); // Force metadata loading
                                    el.play().catch(err => console.log('Initial play failed:', err));
                                }
                            }
                        }}
                        class="absolute inset-0 w-full h-full object-cover"
                        autoplay
                        playsinline
                        muted={false}
                        controls={false}
                        disablepictureinpicture
                        crossOrigin="anonymous"
                    />
                    
                    {!remoteStream() && (
                        <div class="absolute inset-0 flex items-center justify-center bg-gray-900">
                            <div class="text-white text-xl">
                                {callStatus() === 'connecting' ? 'Connecting...' : 'Waiting for remote video...'}
                            </div>
                        </div>
                    )}
                    
                    {/* Local Video (Picture-in-Picture) */}
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
                                    ref={(el) => {
                                        if (el) {
                                            el.srcObject = localStream() || null;
                                            // Safari specific: enhanced local video initialization
                                            if (localStream()) {
                                                // Force metadata load
                                                el.load();
                                                
                                                // Safari specific: multiple play attempts for local video
                                                const attemptLocalPlay = (attempts = 0) => {
                                                    if (attempts >= 10) return;
                                                    
                                                    el.play().then(() => {
                                                        console.log('Local video playing successfully from ref');
                                                    }).catch(err => {
                                                        console.log(`Local video ref play attempt ${attempts + 1} failed:`, err);
                                                        setTimeout(() => attemptLocalPlay(attempts + 1), 200 * (attempts + 1));
                                                    });
                                                };
                                                
                                                // Start play attempts immediately
                                                setTimeout(() => attemptLocalPlay(), 100);
                                            }
                                        }
                                    }}
                                    class="w-full h-full object-cover"
                                    autoplay
                                    muted
                                    playsinline
                                    controls={false}
                                    crossOrigin="anonymous"
                                />
                            )}
                        </div>
                    )}
                    
                    {/* Top Bar - Connection Info */}
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
                    
                    {/* Bottom Controls */}
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



            {/* Incoming Call Modal */}
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
                                    ref={(el) => {
                                        if (el && remoteStream()) {
                                            el.srcObject = remoteStream();
                                        }
                                    }}
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
                                            ref={(el) => {
                                                if (el && localStream()) {
                                                    el.srcObject = localStream();
                                                }
                                            }}
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
                    right: (window.innerWidth - logsPos().x - 360) + 'px',
                    bottom: logsPos().y + 'px', 
                    top: 'auto', 
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
                                    <strong>Video Call in Progress:</strong> SDP exchange is handled automatically via the data channel.
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
                                placeholder="Paste remote SDP here..."
                                value={remoteSDP()}
                                onInput={(e: any) => setRemoteSDP(e.target.value)}
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
