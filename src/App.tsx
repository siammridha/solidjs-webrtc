import { createSignal, onCleanup, onMount } from 'solid-js';

type SDPString = string;

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

    // Simple key-value IndexedDB helpers (stores: 'loacl-sdp' and 'remote-sdps' in DB 'app-db')
async function openKVDB() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('app-db', 3);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('loacl-sdp')) db.createObjectStore('loacl-sdp');
            if (!db.objectStoreNames.contains('remote-sdps')) db.createObjectStore('remote-sdps', { keyPath: 'ramdome' });
            if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key: string): Promise<string | null> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('loacl-sdp', 'readonly');
        const store = tx.objectStore('loacl-sdp');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key: string, value: string): Promise<void> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('loacl-sdp', 'readwrite');
        const store = tx.objectStore('loacl-sdp');
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function idbRemoteSet(value: string): Promise<string> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('remote-sdps', 'readwrite');
        const store = tx.objectStore('remote-sdps');
        const id = (crypto && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
        let req: IDBRequest;
        if (store.keyPath) {
            const obj = { ramdome: id, sdp: value };
            req = store.put(obj);
        } else {
            req = store.put(value, id);
        }
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
    });
}

async function idbRemoteGet(key: string): Promise<string | null> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('remote-sdps', 'readonly');
        const store = tx.objectStore('remote-sdps');
        const req = store.get(key);
        req.onsuccess = () => {
            const res = req.result ?? null;
            if (res && typeof res === 'object' && 'sdp' in res) resolve((res as any).sdp);
            else resolve(res as string | null);
        };
        req.onerror = () => reject(req.error);
    });
}

// Messages helpers (store: 'messages' in app-db)
async function idbGetMessages(key: string): Promise<Array<{ from: 'me' | 'them'; text: string; ts: number }> | null> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

async function idbSetMessages(key: string, arr: Array<{ from: 'me' | 'them'; text: string; ts: number }>): Promise<void> {
    const db = await openKVDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const req = store.put(arr, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function idbAppendMessage(key: string, msg: { from: 'me' | 'them'; text: string; ts: number }): Promise<void> {
    const cur = (await idbGetMessages(key)) ?? [];
    cur.push(msg);
    await idbSetMessages(key, cur);
}

function createPeerConnection(onTrack: (stream: MediaStream) => void, onDataMessage: (msg: string) => void) {
    if (pc) return pc;
    pc = new RTCPeerConnection();

    pc.ontrack = (ev) => {
        if (ev.streams && ev.streams[0]) onTrack(ev.streams[0]);
    };

    pc.ondatachannel = (ev) => {
        dataChannel = ev.channel;
        dataChannel.onmessage = (e) => onDataMessage(e.data);
    };

    return pc;
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
    const [remoteList, setRemoteList] = createSignal<Array<{ ramdome: string; sdp: string }>>([]);
    const [log, setLog] = createSignal<string[]>([]);
    const [selectedRemote, setSelectedRemote] = createSignal<string | null>(null);
    const [chatMap, setChatMap] = createSignal<Record<string, { from: 'me' | 'them'; text: string; ts: number }[]>>({});
    const [showChatPanel, setShowChatPanel] = createSignal(false);
    const [showPermModal, setShowPermModal] = createSignal(false);
    const [permType, setPermType] = createSignal<'audio' | 'video' | null>(null);
    const [permMessage, setPermMessage] = createSignal('');

    let localVideo!: HTMLVideoElement;
    let remoteVideo!: HTMLVideoElement;
    let chatInput!: HTMLInputElement;

    let localStream: MediaStream | null = null;

    function appendLog(s: string) {
        setLog((l) => [...l, s]);
        console.log(s);
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
            const existing = await idbGet('loacl-sdp');
            if (existing) {
                setLocalSDP(existing);
                appendLog('Loaded local SDP from IndexedDB');
                setShowSDPModal(true);
                return;
            }

            await createOffer();
            const s = localSDP();
            if (s) {
                await idbSet('loacl-sdp', s);
                appendLog('Saved local SDP to IndexedDB');
                setShowSDPModal(true);
            } else {
                appendLog('No local SDP to save');
            }
        } catch (e) {
            appendLog('IndexedDB error: ' + String(e));
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

    async function startCamera() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            localVideo.muted = true;
            appendLog('Camera started');
        } catch (e) {
            appendLog('getUserMedia error: ' + String(e));
        }
    }

    async function handlePlusClick() {
        try {
            const sdp = window.prompt('Paste remote SDP to store:');
            if (!sdp) return;
            const id = await idbRemoteSet(sdp);
            appendLog(`Saved remote SDP as ${id}`);
            // initialize empty message list for this remote
            await idbSetMessages(id, []);
            await loadRemoteList();
        } catch (e) {
            appendLog('Remote SDP save error: ' + String(e));
        }
    }

    function selectRemote(id: string) {
        setSelectedRemote(id);
        setShowChatPanel(true);
        setChatMap((m) => ({ ...m, [id]: m[id] ?? [] }));
    }

    async function idbRemoteList(): Promise<Array<{ ramdome: string; sdp: string }>> {
        const db = await openKVDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('remote-sdps', 'readonly');
            const store = tx.objectStore('remote-sdps');
            const req = store.openCursor();
            const out: Array<{ ramdome: string; sdp: string }> = [];
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    const val = cursor.value;
                    if (val && typeof val === 'object' && 'ramdome' in val && 'sdp' in val) {
                        out.push({ ramdome: String(val.ramdome), sdp: String(val.sdp) });
                    } else {
                        out.push({ ramdome: String(cursor.primaryKey), sdp: String(val) });
                    }
                    cursor.continue();
                } else {
                    resolve(out);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async function loadRemoteList() {
        try {
            const list = await idbRemoteList();
            setRemoteList(list);
            // load messages for each remote into chatMap
            const map: Record<string, { from: 'me' | 'them'; text: string; ts: number }[]> = {};
            await Promise.all(list.map(async (it) => {
                try {
                    const msgs = (await idbGetMessages(it.ramdome)) ?? [];
                    map[it.ramdome] = msgs;
                } catch (e) {
                    map[it.ramdome] = [];
                }
            }));
            setChatMap(map);
        } catch (e) {
            appendLog('Failed to load remote list: ' + String(e));
        }
    }

    async function applySavedRemote(id: string) {
        try {
            const s = await idbRemoteGet(id);
            if (!s) {
                appendLog('Remote SDP not found: ' + id);
                return;
            }
            setRemoteSDP(s);
            await applyRemoteSDP();
            appendLog(`Applied remote SDP ${id}`);
            // also select the remote when applied
            selectRemote(id);
        } catch (e) {
            appendLog('Apply saved remote error: ' + String(e));
        }
    }

    function onRemoteTrack(stream: MediaStream) {
        remoteVideo.srcObject = stream;
        appendLog('Remote track received');
    }

    function onDataMessage(msg: string) {
        // route incoming message to selected remote if present, otherwise to the first known remote
        const id = selectedRemote() ?? (remoteList()[0] && remoteList()[0].ramdome) ?? null;
        if (!id) {
            appendLog('Received message but no remote available: ' + msg);
            return;
        }
        const entry = { from: 'them' as const, text: msg, ts: Date.now() };
        setChatMap((m) => ({ ...m, [id]: [...(m[id] ?? []), entry] }));
        // persist
        idbAppendMessage(id, entry).catch((e) => appendLog('Failed to persist incoming msg: ' + String(e)));
        appendLog(`Remote message from ${id}: ${msg}`);
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
                await startCamera();
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
        const connection = createPeerConnection(onRemoteTrack, onDataMessage);
        dataChannel = connection.createDataChannel('chat');
        dataChannel.onmessage = (e) => onDataMessage(e.data);
        dataChannel.onopen = () => appendLog('Data channel open');

        if (localStream) {
            for (const t of localStream.getTracks()) connection.addTrack(t, localStream);
        }

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Offer created');
    }

    async function createAnswerFromRemote(remote: RTCSessionDescriptionInit) {
        const connection = createPeerConnection(onRemoteTrack, onDataMessage);
        if (localStream) {
            for (const t of localStream.getTracks()) connection.addTrack(t, localStream);
        }
        await connection.setRemoteDescription(remote);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await waitForIceGatheringComplete(connection);
        setLocalSDP(JSON.stringify(connection.localDescription));
        appendLog('Answer created');
    }

    async function applyRemoteSDP() {
        try {
            const parsed: RTCSessionDescriptionInit = JSON.parse(remoteSDP());
            // If we received an offer, create answer
            if (parsed.type === 'offer') {
                await createAnswerFromRemote(parsed);
            } else {
                // answer
                if (!pc) createPeerConnection(onRemoteTrack, onDataMessage);
                await pc!.setRemoteDescription(parsed);
                appendLog('Remote answer applied');
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

    onMount(() => {
        loadRemoteList();
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

    function sendChatMessage() {
        const id = selectedRemote();
        if (!id) return;
        const txt = chatInput?.value?.trim();
        if (!txt) return;
        // send over data channel if open
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(txt);
        }
        const entry = { from: 'me' as const, text: txt, ts: Date.now() };
        setChatMap((m) => ({ ...m, [id]: [...(m[id] ?? []), entry] }));
        // persist
        idbAppendMessage(id, entry).catch((e) => appendLog('Failed to persist outgoing msg: ' + String(e)));
        chatInput.value = '';
    }

    return (
        <div class="p-6 max-w-4xl mx-auto relative">
            <div class="absolute top-4 right-4 flex gap-2">
                <button
                    class="p-2 rounded-full hover:bg-gray-200"
                    aria-label="Add Remote SDP"
                    title="Add Remote SDP"
                    onClick={handlePlusClick}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </button>
            </div>

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
                {remoteList().map((r) => (
                    <button class="flex items-center gap-3 px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 text-sm w-full justify-start text-left" onClick={() => selectRemote(r.ramdome)}>
                        <div class="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs">R</div>
                        <div class="truncate flex-1 text-left">{r.ramdome}</div>
                    </button>
                ))}
            </div>

            {/* Camera views removed */}

            {/* Start Camera button removed */}

            {/* Remote SDP is now managed via the + button (stores in remote-sdps DB) */}

            <div
                class="fixed bg-white border rounded shadow z-30"
                style={{ left: logsPos().x + 'px', top: logsPos().y + 'px', width: '360px' }}
                onPointerDown={(e: any) => onLogsPointerDown(e)}
            >
                <div class="px-3 py-2 bg-gray-100 border-b cursor-grab flex items-center justify-between" onPointerDown={(e:any)=>onLogsPointerDown(e)}>
                    <div class="text-sm font-medium">Logs</div>
                    <div class="text-xs text-gray-600">
                        <button class="px-2 py-1" onClick={() => setLogsPos({ x: 40, y: 120 })}>Reset</button>
                    </div>
                </div>
                <div class="h-80 p-2 overflow-auto">
                    {log().map((l) => (
                        <div class="text-xs text-gray-700">{l}</div>
                    ))}
                </div>
            </div>
            {showChatPanel() && selectedRemote() && (
                <div class="fixed right-0 top-0 h-full w-96 bg-white shadow-lg z-40 flex flex-col">
                    <div class="flex items-center justify-between p-3 border-b">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white">R</div>
                            <div class="font-semibold">{selectedRemote()}</div>
                        </div>
                            <div class="flex items-center gap-2">
                                <button class="p-2 rounded hover:bg-gray-100" title="Audio call" aria-label="Audio call" onClick={async ()=>{try{await startAudioCall();}catch(e){appendLog('Audio call error:'+String(e))}}}>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5 2h3a2 2 0 0 1 2 1.72c.12.86.34 1.69.66 2.47a2 2 0 0 1-.45 2.11L9.91 9.91a16 16 0 0 0 6 6l1.61-1.26a2 2 0 0 1 2.11-.45c.78.32 1.61.54 2.47.66A2 2 0 0 1 22 16.92z" />
                                    </svg>
                                </button>
                                <button class="p-2 rounded hover:bg-gray-100" title="Video call" aria-label="Video call" onClick={async ()=>{try{await startVideoCall();}catch(e){appendLog('Video call error:'+String(e))}}}>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="15" height="14" rx="2" ry="2"></rect><polygon points="23 7 16 12 23 17 23 7"></polygon></svg>
                                </button>
                                <button class="px-2 py-1 text-sm text-gray-600" onClick={() => setShowChatPanel(false)}>Close</button>
                            </div>
                    </div>
                    <div class="flex-1 p-3 overflow-auto" id="chat-scroll">
                        {(chatMap()[selectedRemote()!] ?? []).map((m) => (
                            <div class={m.from === 'me' ? 'text-right mb-2' : 'text-left mb-2'}>
                                <div class={m.from === 'me' ? 'inline-block bg-blue-600 text-white px-3 py-1 rounded' : 'inline-block bg-gray-100 px-3 py-1 rounded'}>{m.text}</div>
                            </div>
                        ))}
                    </div>
                    <div class="p-3 border-t">
                        <div class="flex gap-2">
                            <input ref={chatInput} class="flex-1 p-2 border rounded" placeholder="Type a message" onKeyDown={(e:any)=>{ if(e.key==='Enter') sendChatMessage(); }} />
                            <button class="px-3 py-2 bg-green-600 text-white rounded" onClick={sendChatMessage}>Send</button>
                        </div>
                    </div>
                </div>
            )}
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
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowSDPModal(false)}>
                    <div class="bg-white rounded p-4 w-full max-w-2xl mx-4" onClick={(e) => (e.stopPropagation(), false)}>
                        <div class="flex items-center justify-between mb-2">
                            <h2 class="text-lg font-semibold">Local SDP</h2>
                            <button class="text-gray-600 text-2xl leading-none" onClick={() => setShowSDPModal(false)}>×</button>
                        </div>
                        <textarea class="w-full h-64 p-2 border rounded mb-3" value={localSDP()} readonly />
                        <div class="flex justify-end gap-2">
                            <button class="px-3 py-1 bg-gray-200 rounded" onClick={() => setShowSDPModal(false)}>Close</button>
                            <button class="px-3 py-1 bg-indigo-600 text-white rounded" onClick={copyLocalSDP}>{copied() ? 'Copied' : 'Copy'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
