import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import { version } from 'vite';

type SDPString = string;

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
    const [showSDPModal, setShowSDPModal] = createSignal(false);
    const [copied, setCopied] = createSignal(false);
    const [log, setLog] = createSignal<string[]>([]);

    const [showPermModal, setShowPermModal] = createSignal(false);
    const [permType, setPermType] = createSignal<'audio' | 'video' | null>(null);
    const [permMessage, setPermMessage] = createSignal('');
    const [connectionStatus, setConnectionStatus] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');


    let localVideo!: HTMLVideoElement;
    let remoteVideo!: HTMLVideoElement;

    let localStream: MediaStream | null = null;

    function appendLog(s: string) {
        setLog((l) => [...l, s]);
        console.log(s);
    }

    function createPeerConnectionWithStatus(onTrack: (stream: MediaStream) => void, onDataMessage: (msg: string) => void) {
        if (pc) return pc;
        pc = new RTCPeerConnection();

        // Log initial state
        appendLog(`RTCPeerConnection created - initial state: ${pc.connectionState}, ICE: ${pc.iceConnectionState}, gathering: ${pc.iceGatheringState}`);

        pc.ontrack = (ev) => {
            appendLog(`ontrack: received track ${ev.track.kind} from ${ev.track.id}, stream count: ${ev.streams.length}`);
            if (ev.streams && ev.streams[0]) onTrack(ev.streams[0]);
        };

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

        pc.onconnectionstatechange = () => {
            const state = pc?.connectionState;
            appendLog(`onconnectionstatechange: ${state}`);
            if (state === 'connected') {
                setShowSDPModal(false);
                setConnectionStatus('connected');
            } else if (state === 'disconnected' || state === 'failed') {
                setConnectionStatus('disconnected');
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

        pc.onnegotiationneeded = () => {
            appendLog('onnegotiationneeded: renegotiation required');
        };

        return pc;
    }

    async function checkPermission(kind: 'audio' | 'video'): Promise<'granted' | 'denied' | 'prompt' | null> {
        try {
            const permApi = (navigator as any).permissions;
            if (!permApi || !permApi.query) return null;
            if (kind === 'audio') {
                const res = await permApi.query({ name: 'microphone' } as any);
                return res.state as 'granted' | 'denied' | 'prompt';
            }
            // for video check both camera and microphone where available
            const cam = await permApi.query({ name: 'camera' } as any).catch(() => null);
            const mic = await permApi.query({ name: 'microphone' } as any).catch(() => null);
            if ((cam && cam.state === 'denied') || (mic && mic.state === 'denied')) return 'denied';
            if ((cam && cam.state === 'granted') && (mic && mic.state === 'granted')) return 'granted';
            return 'prompt';
        } catch (e) {
            return null;
        }
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

    function onRemoteTrack(stream: MediaStream) {
        if (remoteVideo) {
            remoteVideo.srcObject = stream;
        }
        appendLog('Remote track received');
    }

    function onDataMessage(msg: string) {
        // Chat functionality simplified - just log incoming messages
        appendLog('Received message: ' + msg);
    }

    async function startVideoCall() {
        try {
            const state = await checkPermission('video');
            if (state === 'denied') {
                setPermType('video');
                setPermMessage('Camera and/or microphone permission is blocked in your browser. Please enable access in site settings.');
                setShowPermModal(true);
                appendLog('Permission state denied for video, showing modal');
                return;
            }
            let timer: any = setTimeout(() => {
                if (!localStream) {
                    setPermType('video');
                    setPermMessage('Unable to acquire camera/microphone — permission may be blocked.');
                    setShowPermModal(true);
                    appendLog('Permission modal fallback triggered for video');
                }
            }, 1200);
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (localVideo) {
                    localVideo.srcObject = localStream;
                    localVideo.muted = true;
                }
                appendLog('Video call started (local stream acquired)');
            } finally {
                clearTimeout(timer);
            }
        } catch (e) {
            appendLog('startVideoCall error: ' + String(e));
            const err = e as any;
            setPermType('video');
            setPermMessage('Camera and microphone access was denied or failed: ' + (err?.message ?? String(e)));
            appendLog('Showing permission modal: ' + (err?.message ?? String(e)));
            setShowPermModal(true);
            return;
        }
    }

    async function startAudioCall() {
        try {
            const state = await checkPermission('audio');
            if (state === 'denied') {
                setPermType('audio');
                setPermMessage('Microphone permission is blocked in your browser. Please enable access in site settings.');
                setShowPermModal(true);
                appendLog('Permission state denied for audio, showing modal');
                return;
            }
            let timer: any = setTimeout(() => {
                if (!localStream) {
                    setPermType('audio');
                    setPermMessage('Unable to acquire microphone — permission may be blocked.');
                    setShowPermModal(true);
                    appendLog('Permission modal fallback triggered for audio');
                }
            }, 1200);
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                appendLog('Audio call started (local audio acquired)');
            } finally {
                clearTimeout(timer);
            }
        } catch (e) {
            appendLog('startAudioCall error: ' + String(e));
            const err = e as any;
            setPermType('audio');
            setPermMessage('Microphone access was denied or failed: ' + (err?.message ?? String(e)));
            appendLog('Showing permission modal: ' + (err?.message ?? String(e)));
            setShowPermModal(true);
            return;
        }
    }

    async function createOffer() {
        const connection = createPeerConnectionWithStatus(onRemoteTrack, onDataMessage);
        dataChannel = connection.createDataChannel('chat');
        appendLog(`createDataChannel: created data channel 'chat', state: ${dataChannel.readyState}`);
        
        dataChannel.onmessage = (e) => onDataMessage(e.data);
        dataChannel.onopen = () => appendLog('Data channel opened (offerer)');
        dataChannel.onclose = () => appendLog('Data channel closed (offerer)');
        dataChannel.onerror = (e) => appendLog('Data channel error (offerer): ' + String(e));

        // Ensure we have media tracks for ICE candidates
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                appendLog('Acquired media stream for SDP generation');
            } catch (e) {
                appendLog('Failed to acquire media stream: ' + String(e));
                // Continue without media - will generate data channel only SDP
            }
        }

        if (localStream) {
            for (const t of localStream.getTracks()) {
                connection.addTrack(t, localStream);
                appendLog(`addTrack: added ${t.kind} track ${t.id} to connection`);
            }
        }

        const offer = await connection.createOffer();
        appendLog(`createOffer: offer created, type: ${offer.type}`);
        await connection.setLocalDescription(offer);
        appendLog('setLocalDescription: offer set as local description');
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Offer created with media tracks and ICE candidates');
    }

    async function createAnswerFromRemote(remote: RTCSessionDescriptionInit) {
        const connection = createPeerConnectionWithStatus(onRemoteTrack, onDataMessage);
        
        appendLog(`createAnswerFromRemote: processing remote ${remote.type}`);
        
        // Ensure we have media tracks for ICE candidates
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                appendLog('Acquired media stream for answer generation');
            } catch (e) {
                appendLog('Failed to acquire media stream for answer: ' + String(e));
            }
        }
        
        if (localStream) {
            for (const t of localStream.getTracks()) {
                connection.addTrack(t, localStream);
                appendLog(`addTrack: added ${t.kind} track ${t.id} to connection (answerer)`);
            }
        }
        
        await connection.setRemoteDescription(remote);
        appendLog('setRemoteDescription: remote offer set');
        const answer = await connection.createAnswer();
        appendLog(`createAnswer: answer created, type: ${answer.type}`);
        await connection.setLocalDescription(answer);
        appendLog('setLocalDescription: answer set as local description');
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Answer created with media tracks and ICE candidates');
    }

    async function applyRemoteSDP() {
        try {
            const parsed: RTCSessionDescriptionInit = JSON.parse(remoteSDP());
            appendLog(`applyRemoteSDP: parsing remote SDP of type ${parsed.type}`);
            
            // If we received an offer, create answer
            if (parsed.type === 'offer') {
                await createAnswerFromRemote(parsed);
            } else {
                // answer
                appendLog('applyRemoteSDP: processing remote answer');
                if (!pc) createPeerConnectionWithStatus(onRemoteTrack, onDataMessage);
                
                // Ensure we have media tracks when applying answer
                if (!localStream) {
                    try {
                        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        appendLog('Acquired media stream before applying remote answer');
                        for (const t of localStream.getTracks()) {
                            pc!.addTrack(t, localStream);
                            appendLog(`addTrack: added ${t.kind} track ${t.id} before applying remote answer`);
                        }
                    } catch (e) {
                        appendLog('Failed to acquire media stream for remote answer: ' + String(e));
                    }
                }
                
                await pc!.setRemoteDescription(parsed);
                appendLog('setRemoteDescription: remote answer applied successfully');
            }
        } catch (e) {
            appendLog('Invalid remote SDP: ' + String(e));
        }
    }

    // sendMessage removed (chat UI removed)

    onCleanup(() => {
        if (localStream) {
            for (const t of localStream.getTracks()) t.stop();
        }
        if (pc) pc.close();
    });

    // Auto-scroll logs to bottom when new logs are added
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

    const [logsPos, setLogsPos] = createSignal<{ x: number; y: number }>({ x: 40, y: 120 });
    const [dragging, setDragging] = createSignal(false);
    let dragOffset = { x: 0, y: 0 };

    function onLogsPointerDown(e: PointerEvent) {
        setDragging(true);
        dragOffset.x = e.clientX - logsPos().x;
        dragOffset.y = e.clientY - logsPos().y;
        try { (e.target as Element).setPointerCapture?.((e as any).pointerId); } catch {}
        e.stopPropagation();
    }

    function onLogsPointerMove(e: PointerEvent) {
        if (!dragging()) return;
        setLogsPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
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
        <div class="p-6 max-w-4xl mx-auto relative">

            <div class="absolute top-4 left-4">
                <button
                    class="p-2 rounded-full hover:bg-gray-200"
                    aria-label="Settings"
                    title="Settings"
                    onClick={handleSettingsClick}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gray-700" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M19.43 12.98c.04-.32.07-.66.07-1s-.03-.68-.07-1l2.11-1.65a.5.5 0 00.12-.63l-2-3.46a.5.5 0 00-.6-.22l-2.49 1a7.07 7.07 0 00-1.7-.99l-.38-2.65A.5.5 0 0014.5 2h-5a.5.5 0 00-.5.41l-.38 2.65c-.6.23-1.17.53-1.7.99l-2.49-1a.5.5 0 00-.6.22l-2 3.46a.5.5 0 00.12.63L4.57 11c-.05.33-.07.66-.07 1s.03.68.07 1L2.46 14.65a.5.5 0 00-.12.63l2 3.46c.14.24.44.34.7.22l2.49-1c.52.4 1.08.73 1.7.99l.38 2.65c.05.27.28.41.5.41h5c.22 0 .45-.14.5-.41l.38-2.65c.62-.26 1.18-.59 1.7-.99l2.49 1c.26.11.56.01.7-.22l2-3.46a.5.5 0 00-.12-.63l-2.11-1.65zM12 15.5A3.5 3.5 0 1115.5 12 3.5 3.5 0 0112 15.5z" />
                    </svg>
                </button>
            </div>

            
            <div class="mt-16 flex flex-col gap-2 items-start">
                <div class="px-3 py-2 bg-blue-100 rounded text-sm w-full text-blue-800">
                    Use the Settings button to open SDP modal for peer connections
                </div>
            </div>

            {/* Remote SDP is now managed via the + button (stores in remote-sdps DB) */}

            <div
                class="fixed bg-white border rounded shadow z-50"
                style={{ left: logsPos().x + 'px', top: logsPos().y + 'px', width: '360px' }}
                onPointerDown={(e: any) => onLogsPointerDown(e)}
            >
                <div class="px-3 py-2 bg-gray-100 border-b cursor-grab flex items-center justify-between" onPointerDown={(e:any)=>onLogsPointerDown(e)}>
                    <div class="text-sm font-medium">Logs</div>
                    <div class="text-xs text-gray-600">
                        <button class="px-2 py-1" onClick={() => setLogsPos({ x: 40, y: 120 })}>Reset</button>
                    </div>
                </div>
                <div class="h-80 p-2 overflow-auto" id="logs-container">
                    {log().map((l) => (
                        <div class="text-xs text-gray-700">{l}</div>
                    ))}
                </div>
            </div>
            {/* Chat panel removed - remote users managed via SDP modal */}
            {showPermModal() && (
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowPermModal(false)}>
                    <div class="bg-white rounded p-4 w-full max-w-md mx-4" onClick={(e) => (e.stopPropagation(), false)}>
                        <div class="mb-3">
                            <h3 class="text-lg font-semibold">Permission required</h3>
                            <p class="text-sm text-gray-700 mt-2">{permMessage()}</p>
                        </div>
                        <div class="flex justify-end gap-2">
                            <button class="px-3 py-1 bg-gray-200 rounded" onClick={() => setShowPermModal(false)}>Close</button>
                            <button class="px-3 py-1 bg-indigo-600 text-white rounded" onClick={async () => {
                                setShowPermModal(false);
                                const t = permType();
                                try {
                                    if (t === 'video') await startVideoCall();
                                    else if (t === 'audio') await startAudioCall();
                                } catch (e) {
                                    appendLog('Retry failed: ' + String(e));
                                }
                            }}>Retry</button>
                        </div>
                    </div>
                </div>
            )}
            {showSDPModal() && (
                <div class="fixed inset-0 z-40 flex items-center justify-center" style={{ 'background-color': 'rgba(0, 0, 0, 0.2)' }} onClick={() => setShowSDPModal(false)}>
                    <div class="bg-white rounded p-4 w-full max-w-2xl mx-4" onClick={(e) => (e.stopPropagation(), false)}>
                        <div class="flex items-center justify-between mb-2">
                            <h2 class="text-lg font-semibold">SDP Exchange</h2>
                            <button class="text-gray-600 text-2xl leading-none" onClick={() => setShowSDPModal(false)}>×</button>
                        </div>
                        
                        {/* Local SDP Display */}
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <label class="block text-sm font-medium">Local SDP</label>
                                <button 
                                    class="px-3 py-1 bg-green-600 text-white rounded" 
                                    onClick={async () => {
                                        try {
                                            await createOffer();
                                            appendLog('Local SDP created');
                                        } catch (e) {
                                            appendLog('Failed to create offer: ' + String(e));
                                        }
                                    }}
                                >
                                    Create Offer
                                </button>
                            </div>
                            <div class="flex gap-2">
                                <textarea class="flex-1 h-64 p-2 border rounded" value={localSDP()} readonly />
                                <button class="px-3 py-1 bg-indigo-600 text-white rounded self-start" onClick={copyLocalSDP}>{copied() ? 'Copied' : 'Copy'}</button>
                            </div>
                        </div>

                        {/* Remote SDP Input */}
                        <div class="mb-4">
                            <label class="block text-sm font-medium mb-2">Remote SDP</label>
                            <textarea 
                                class="w-full h-32 p-2 border rounded mb-2" 
                                placeholder="Paste remote SDP here..."
                                value={remoteSDP()}
                                onInput={(e: any) => setRemoteSDP(e.target.value)}
                            />
                            <button 
                                class="px-3 py-1 bg-green-600 text-white rounded mr-2" 
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
