import { createSignal, onCleanup } from 'solid-js';

type SDPString = string;

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;

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
    const [log, setLog] = createSignal<string[]>([]);
    const [chat, setChat] = createSignal<string[]>([]);

    let localVideo!: HTMLVideoElement;
    let remoteVideo!: HTMLVideoElement;
    let messageInput!: HTMLInputElement;

    let localStream: MediaStream | null = null;

    function appendLog(s: string) {
        setLog((l) => [...l, s]);
        console.log(s);
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

    function onRemoteTrack(stream: MediaStream) {
        remoteVideo.srcObject = stream;
        appendLog('Remote track received');
    }

    function onDataMessage(msg: string) {
        setChat((c) => [...c, `Remote: ${msg}`]);
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

    function sendMessage() {
        const txt = messageInput.value.trim();
        if (!txt || !dataChannel || dataChannel.readyState !== 'open') return;
        dataChannel.send(txt);
        setChat((c) => [...c, `You: ${txt}`]);
        messageInput.value = '';
    }

    onCleanup(() => {
        if (localStream) {
            for (const t of localStream.getTracks()) t.stop();
        }
        if (pc) pc.close();
    });

    return (
        <div class="p-6 max-w-4xl mx-auto">
            <h1 class="text-2xl font-semibold mb-4">Solid WebRTC PWA — Manual Signaling</h1>

            <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <div class="text-sm font-medium mb-2">Local</div>
                    <video ref={localVideo} autoplay playsinline class="w-full bg-black rounded" />
                </div>
                <div>
                    <div class="text-sm font-medium mb-2">Remote</div>
                    <video ref={remoteVideo} autoplay playsinline class="w-full bg-black rounded" />
                </div>
            </div>

            <div class="flex gap-2 mb-4">
                <button class="px-3 py-2 bg-teal-500 text-white rounded" onClick={startCamera}>Start Camera</button>
                <button class="px-3 py-2 bg-blue-600 text-white rounded" onClick={createOffer}>Create Offer</button>
                <button class="px-3 py-2 bg-green-600 text-white rounded" onClick={applyRemoteSDP}>Apply Remote SDP</button>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-medium mb-1">Local SDP (share this)</label>
                    <textarea class="w-full h-40 p-2 border rounded" value={localSDP()} readonly />
                    <div class="text-xs text-gray-500 mt-1">Copy and send this JSON to the other peer.</div>
                </div>
                <div>
                    <label class="block text-xs font-medium mb-1">Remote SDP (paste here)</label>
                    <textarea class="w-full h-40 p-2 border rounded" onInput={(e) => setRemoteSDP((e.target as HTMLTextAreaElement).value)} value={remoteSDP()} />
                    <div class="flex gap-2 mt-2">
                        <button class="px-2 py-1 bg-indigo-600 text-white rounded" onClick={applyRemoteSDP}>Set Remote</button>
                    </div>
                </div>
            </div>

            <div class="mt-6 grid grid-cols-2 gap-4">
                <div>
                    <div class="text-sm font-medium mb-2">Chat</div>
                    <div class="h-48 p-2 border rounded overflow-auto bg-white">
                        {chat().map((m) => (
                            <div class="text-sm py-0.5">{m}</div>
                        ))}
                    </div>
                    <div class="flex gap-2 mt-2">
                        <input ref={messageInput} class="flex-1 p-2 border rounded" placeholder="Type message" />
                        <button class="px-3 py-2 bg-sky-600 text-white rounded" onClick={sendMessage}>Send</button>
                    </div>
                </div>

                <div>
                    <div class="text-sm font-medium mb-2">Logs</div>
                    <div class="h-48 p-2 border rounded overflow-auto bg-white">
                        {log().map((l) => (
                            <div class="text-xs text-gray-700">{l}</div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
