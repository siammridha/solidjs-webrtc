import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import { version } from 'vite';

type SDPString = string;

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

// IndexedDB setup
const DB_NAME = 'WebRTCSDPStore';
const DB_VERSION = 1;
const STORE_NAME = 'connections';

interface StoredConnection {
    id: string;
    name: string;
    localSDP: string;
    remoteSDP: string;
    timestamp: number;
}

async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp');
            }
        };
    });
}

async function storeConnection(localSDP: string, remoteSDP: string, connectionName: string, logFn: (msg: string) => void): Promise<void> {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const connectionData: StoredConnection = {
            id: `connection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: connectionName.trim() || `User ${new Date().toLocaleString()}`,
            localSDP,
            remoteSDP,
            timestamp: Date.now()
        };
        
        store.put(connectionData);
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
        });
        db.close();
        logFn('Connection stored in IndexedDB: ' + connectionData.name);
    } catch (error) {
        logFn('Failed to store connection in IndexedDB: ' + String(error));
    }
}

async function getAllStoredConnections(logFn: (msg: string) => void): Promise<StoredConnection[]> {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        const result = await new Promise<StoredConnection[]>((resolve, reject) => {
            const connections: StoredConnection[] = [];
            const request = store.openCursor();
            
            request.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest).result;
                if (cursor) {
                    connections.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(connections);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
        
        db.close();
        
        // Sort by timestamp (newest first)
        result.sort((a, b) => b.timestamp - a.timestamp);
        
        if (result.length > 0) {
            logFn(`Retrieved ${result.length} stored connections from IndexedDB`);
        }
        return result;
    } catch (error) {
        logFn('Failed to retrieve connections from IndexedDB: ' + String(error));
        return [];
    }
}

async function deleteConnection(connectionId: string, logFn: (msg: string) => void): Promise<void> {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        store.delete(connectionId);
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
        });
        db.close();
        logFn('Connection deleted from IndexedDB');
    } catch (error) {
        logFn('Failed to delete connection from IndexedDB: ' + String(error));
    }
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
    const [storedConnections, setStoredConnections] = createSignal<StoredConnection[]>([]);
    const [newConnectionName, setNewConnectionName] = createSignal('');
    const [activeChat, setActiveChat] = createSignal<StoredConnection | null>(null);
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
                
                // Store connection in IndexedDB and clear state
                const local = localSDP();
                const remote = remoteSDP();
                if (local && remote) {
                    await storeConnection(local, remote, newConnectionName(), appendLog);
                    setLocalSDP('');
                    setRemoteSDP('');
                    setNewConnectionName('');
                    await refreshConnections();
                    appendLog('SDP state cleared after storing in IndexedDB');
                }
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

    function openChatConnection(connection: StoredConnection) {
        setActiveChat(connection);
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
        setActiveChat(null);
        setMessageInput('');
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

    // Load stored connections on mount and refresh after changes
    const refreshConnections = async () => {
        const connections = await getAllStoredConnections(appendLog);
        setStoredConnections(connections);
    };

    onMount(() => {
        refreshConnections();
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

    const [logsPos, setLogsPos] = createSignal<{ x: number; y: number }>({ x: 40, y: 40 });
    const [dragging, setDragging] = createSignal(false);
    let dragOffset = { x: 0, y: 0 };

    function onLogsPointerDown(e: PointerEvent) {
        setDragging(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = window.innerHeight - e.clientY - rect.height;
        try { (e.target as Element).setPointerCapture?.((e as any).pointerId); } catch {}
        e.stopPropagation();
    }

    function onLogsPointerMove(e: PointerEvent) {
        if (!dragging()) return;
        setLogsPos({ 
            x: e.clientX - dragOffset.x, 
            y: window.innerHeight - e.clientY - dragOffset.y 
        });
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
                    Click on a connection to start chatting, or use Settings to add new connections
                </div>
            </div>

            {/* Connection List on Main Page */}
            <div class="mt-6">
                <h2 class="text-lg font-semibold mb-4">Connections</h2>
                {storedConnections().length > 0 ? (
                    <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {storedConnections().map((connection) => (
                            <div class="p-4 border rounded-lg hover:shadow-md transition-shadow bg-white relative group">
                                <button
                                    class="absolute top-2 right-2 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete connection "${connection.name}"?`)) {
                                            await deleteConnection(connection.id, appendLog);
                                            await refreshConnections();
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
                                            {connectionStatus() === 'connected' && activeChat()?.id === connection.id ? (
                                                <span class="text-green-600">● Active</span>
                                            ) : (
                                                <span class="text-gray-400">○</span>
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
                ) : (
                    <div class="text-center py-8 text-gray-500">
                        <div class="text-lg mb-2">No connections yet</div>
                        <div class="text-sm">Use the Settings button to create your first connection</div>
                    </div>
                )}
            </div>

            {/* Chat Window */}
            {activeChat() && (
                <div class="fixed bottom-4 right-4 w-80 h-96 bg-white border rounded-lg shadow-lg z-30 flex flex-col">
                    <div class="px-4 py-3 border-b flex items-center justify-between bg-gray-50 rounded-t-lg">
                        <div class="font-medium">{activeChat()!.name}</div>
                        <button 
                            class="text-gray-500 hover:text-gray-700"
                            onClick={closeChat}
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
                    left: logsPos().x + 'px', 
                    bottom: logsPos().y + 'px', 
                    top: 'auto', 
                    width: '360px' 
                }}
                onPointerDown={(e: any) => onLogsPointerDown(e)}
            >
                <div class="px-3 py-2 bg-gray-100 border-b cursor-grab flex items-center justify-between" onPointerDown={(e:any)=>onLogsPointerDown(e)}>
                    <div class="text-sm font-medium">Logs</div>
                    <div class="text-xs text-gray-600">
                        <button class="px-2 py-1" onClick={() => setLogsPos({ x: 40, y: 40 })}>Reset</button>
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
