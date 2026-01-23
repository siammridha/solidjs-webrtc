import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import { version } from 'vite';

type SDPString = string;

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

interface Connection {
    id: string;
    name: string;
    timestamp: number;
}



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
    const [connectionStatus, setConnectionStatus] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');
const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
    const [storedConnections, setStoredConnections] = createSignal<Connection[]>([]);
    const [newConnectionName, setNewConnectionName] = createSignal('');
    const [activeChat, setActiveChat] = createSignal<Connection | null>(null);
    const [showChatWindow, setShowChatWindow] = createSignal(false);
    const [chatMessages, setChatMessages] = createSignal<{ [connectionId: string]: string[] }>({});
    const [messageInput, setMessageInput] = createSignal('');




    function appendLog(s: string) {
        setLog((l) => [...l, s]);
        console.log(s);
    }

    function createPeerConnectionWithStatus(onDataMessage: (msg: string) => void) {
        if (pc) return pc;
        pc = new RTCPeerConnection();

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
                
                // Create connection in memory and clear state
                const connectionName = newConnectionName().trim() || `User ${new Date().toLocaleString()}`;
                const newConnection: Connection = {
                    id: `connection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: connectionName,
                    timestamp: Date.now()
                };
                
                setStoredConnections(prev => [newConnection, ...prev]);
                setActiveConnectionId(newConnection.id);
                setLocalSDP('');
                setRemoteSDP('');
                setNewConnectionName('');
                appendLog('Connection established and added to list: ' + newConnection.name);
            } else if (state === 'disconnected' || state === 'failed') {
                setConnectionStatus('disconnected');
                setActiveConnectionId(null);
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



    function onDataMessage(msg: string) {
        const active = activeChat();
        if (active) {
            setChatMessages(prev => ({
                ...prev,
                [active.id]: [...(prev[active.id] || []), `${active.name}: ${msg}`]
            }));
        }
        appendLog('Received message: ' + msg);
    }

    function openChatConnection(connection: Connection) {
        setActiveChat(connection);
        setShowChatWindow(true);
        appendLog('Opening chat with: ' + connection.name);
    }

    async function sendMessage() {
        const msg = messageInput().trim();
        if (!msg || !dataChannel || dataChannel.readyState !== 'open') {
            appendLog('Cannot send message - data channel not ready');
            return;
        }

        const active = activeChat();
        if (!active) return;

        try {
            dataChannel.send(msg);
            setChatMessages(prev => ({
                ...prev,
                [active.id]: [...(prev[active.id] || []), `You: ${msg}`]
            }));
            setMessageInput('');
            appendLog('Message sent: ' + msg);
        } catch (error) {
            appendLog('Failed to send message: ' + String(error));
        }
    }

    function closeChat() {
        console.log('closeChat called, current activeChat:', activeChat());
        setActiveChat(null);
        setShowChatWindow(false);
        setMessageInput('');
        console.log('closeChat finished, new activeChat:', activeChat());
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
        
        await connection.setRemoteDescription(remote);
        appendLog('setRemoteDescription: remote offer set');
        const answer = await connection.createAnswer();
        appendLog(`createAnswer: answer created, type: ${answer.type}`);
        await connection.setLocalDescription(answer);
        appendLog('setLocalDescription: answer set as local description');
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Answer created with data channel and ICE candidates');
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
                if (!pc) createPeerConnectionWithStatus(onDataMessage);
                
                await pc!.setRemoteDescription(parsed);
                appendLog('setRemoteDescription: remote answer applied successfully');
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
        const active = activeChat();
        if (active) {
            setTimeout(() => {
                const chatContainer = document.getElementById('chat-messages');
                if (chatContainer) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }, 0);
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
        <div class="p-6 max-w-4xl mx-auto relative">



            
            <div class="mt-16 flex flex-col gap-2 items-start">
                <div class="px-3 py-2 bg-blue-100 rounded text-sm w-full text-blue-800">
                    Click on a connection to start chatting, or click the "Create New Connection" card to add new connections
                </div>
            </div>

            {/* Connection List on Main Page */}
            <div class="mt-6">
                <h2 class="text-lg font-semibold mb-4">Connections</h2>
                <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {/* Create New Connection Card */}
                    <div 
                        class="p-4 border-2 border-dashed rounded-lg hover:shadow-md transition-shadow bg-gray-50 cursor-pointer flex flex-col items-center justify-center min-h-[120px]"
                        onClick={handleSettingsClick}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                        </svg>
                        <div class="text-sm font-medium text-gray-600">Create New Connection</div>
                    </div>
                    
                    {storedConnections().map((connection) => (
                        <div class="p-4 border rounded-lg hover:shadow-md transition-shadow bg-white relative group">
                            <button
                                class="absolute top-2 right-2 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete connection "${connection.name}"?`)) {
                                        setStoredConnections(prev => prev.filter(c => c.id !== connection.id));
                                        if (activeChat()?.id === connection.id) {
                                            closeChat();
                                        }
                                        appendLog('Deleted connection: ' + connection.name);
                                    }
                                }}
                                title="Delete connection"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                            <div 
                                class="cursor-pointer"
                                onClick={() => openChatConnection(connection)}
                            >
                                <div class="flex items-center justify-between mb-2 pr-10">
                                    <div class="font-medium text-lg truncate flex-1">{connection.name}</div>
                                    <div class="text-xs text-gray-500 ml-2">
                                        {activeConnectionId() === connection.id ? (
                                            <span class="text-green-600">● Connected</span>
                                        ) : connectionStatus() === 'connecting' ? (
                                            <span class="text-yellow-600">● Connecting</span>
                                        ) : (
                                            <span class="text-gray-400">○ Disconnected</span>
                                        )}
                                    </div>
                                </div>
                                <div class="text-sm text-gray-600">
                                    {new Date(connection.timestamp).toLocaleString()}
                                </div>
                                <div class="text-xs text-gray-500 mt-2">
                                    Click to open chat
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Window */}
            {showChatWindow() && activeChat() && (
                <div class="fixed bottom-4 right-4 w-80 h-96 bg-white border rounded-lg shadow-lg z-30 flex flex-col">
                    <div class="px-4 py-3 border-b flex items-center justify-between bg-gray-50 rounded-t-lg">
                        <div class="font-medium">{activeChat()!.name}</div>
                        <button 
                            class="text-gray-500 hover:text-gray-700 text-xl leading-none w-6 h-6 flex items-center justify-center"
                            onClick={(e) => {
                                console.log('Close button clicked');
                                e.stopPropagation();
                                closeChat();
                                console.log('After closeChat call, activeChat:', activeChat());
                            }}
                        >
                            ×
                        </button>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto p-4 space-y-2" id="chat-messages">
                        {chatMessages()[activeChat()!.id]?.length > 0 ? (
                            chatMessages()[activeChat()!.id].map((msg) => (
                                <div 
                                    class={`text-sm ${msg.startsWith('You:') ? 'text-right' : 'text-left'}`}
                                >
                                    <span 
                                        class={`inline-block px-3 py-2 rounded-lg ${
                                            msg.startsWith('You:') 
                                                ? 'bg-blue-500 text-white' 
                                                : 'bg-gray-200 text-gray-800'
                                        }`}
                                    >
                                        {msg}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div class="text-center text-gray-500 text-sm mt-4">
                                No messages yet. Start a conversation!
                            </div>
                        )}
                    </div>
                    
                    <div class="px-4 py-3 border-t">
                        <div class="flex gap-2">
                            <input 
                                type="text" 
                                class="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Type a message..."
                                value={messageInput()}
                                onInput={(e: any) => setMessageInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            />
                            <button 
                                class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                                onClick={sendMessage}
                                disabled={!messageInput().trim() || connectionStatus() !== 'connected'}
                            >
                                Send
                            </button>
                        </div>
                        {connectionStatus() !== 'connected' && (
                            <div class="text-xs text-red-500 mt-1">
                                Connection not ready
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

                        {/* Connection Name Input */}
                        <div class="mb-4">
                            <label class="block text-sm font-medium mb-2">Connection Name (optional)</label>
                            <input 
                                type="text" 
                                class="w-full p-2 border rounded mb-2" 
                                placeholder="Enter a name for this connection..."
                                value={newConnectionName()}
                                onInput={(e: any) => setNewConnectionName(e.target.value)}
                            />
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
