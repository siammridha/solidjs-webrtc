import { createEffect } from 'solid-js';
import RemoteVideo from './RemoteVideo';
import LocalVideo from './LocalVideo';

interface MessagesProps {
    chatMessages: () => Array<{text: string, isOwn: boolean}>;
    messageInput: () => string;
    connectionStatus: () => 'disconnected' | 'connecting' | 'connected';
    callStatus: () => 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ending';
    isInCall: () => boolean;
    localStream: () => MediaStream | null;
    remoteStream: () => MediaStream | null;
    isVideoMuted: () => boolean;
    onMessageInput: (value: string) => void;
    onSendMessage: () => void;
    onStartCall: () => void;
    onEndCall: () => void;
}

const VideoIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const AudioIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
);

function ConnectionStatusIndicator(props: { status: 'disconnected' | 'connecting' | 'connected' }) {
    return (
        <div class={`w-2 h-2 rounded-full ${
            props.status === 'connected' ? 'bg-green-500' : 
            props.status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
            'bg-gray-400'
        }`} title={props.status} />
    );
}

export default function Messages(props: MessagesProps) {
    createEffect(() => {
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});

    return (
        <div class={`fixed bg-gray-900 shadow-lg z-30 flex flex-col transition-all duration-300 ${
            props.isInCall() 
                ? 'bottom-4 right-4 w-80 h-[600px] rounded-2xl' 
                : 'inset-0 rounded-none'
        }`}>
                    <div class={`px-4 py-3 flex items-center justify-between bg-gray-800/90 backdrop-blur-lg ${props.isInCall() ? 'rounded-t-2xl' : 'rounded-t-2xl'}`}>
                        <div class="flex items-center gap-2">
                            <div class="font-medium text-white">Chat</div>
                            <div class="flex items-center gap-1">
                                <ConnectionStatusIndicator status={props.connectionStatus()} />
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            {!props.isInCall() ? (
                                <button
                                    class={`p-2 rounded-full backdrop-blur-sm transition-all duration-200 hover:scale-110 ${
                                        props.connectionStatus() === 'connected' && props.callStatus() === 'idle'
                                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                            : props.callStatus() === 'calling'
                                            ? 'bg-yellow-500/20 text-yellow-400 animate-pulse'
                                            : 'bg-gray-500/20 text-gray-400 cursor-not-allowed'
                                    }`}
                                    onClick={props.onStartCall}
                                    disabled={props.connectionStatus() !== 'connected' || props.callStatus() !== 'idle'}
                                    title={props.connectionStatus() !== 'connected' ? 'No connection' : props.callStatus() === 'calling' ? 'Calling...' : props.callStatus() === 'idle' ? 'Start video call' : 'Call in progress...'}
                                >
                                    {props.callStatus() === 'calling' ? (
                                        <AudioIcon class="w-5 h-5" />
                                    ) : (
                                        <VideoIcon class="w-5 h-5" />
                                    )}
                                </button>
                            ) : (
                                <button
                                    class="p-2 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 backdrop-blur-sm transition-all duration-200 hover:scale-110"
                                    onClick={props.onEndCall}
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
                    {props.isInCall() && (
                        <div class="border-t border-gray-700/50 bg-gray-800/50 backdrop-blur-sm">
                            {props.callStatus() === 'connecting' && (
                                <div class="bg-blue-600/80 backdrop-blur-sm text-white text-xs px-3 py-2 text-center border border-blue-500/30">
                                    Copy the SDP from the modal and send it to the remote peer
                                </div>
                            )}
                            <div class="relative h-48">
                                <RemoteVideo
                                    remoteStream={props.remoteStream}
                                    callStatus={props.callStatus}
                                    variant="chat"
                                />
                                <LocalVideo
                                    localStream={props.localStream}
                                    isVideoMuted={props.isVideoMuted}
                                    isInCall={props.isInCall}
                                    variant="chat-pip"
                                />
                            </div>
                        </div>
                    )}
                    
                    <div class={`overflow-y-auto p-4 space-y-2 ${props.isInCall() ? 'h-32' : 'flex-1 min-h-0'}`} id="chat-messages">
                        {props.chatMessages().length > 0 ? (
                            props.chatMessages().map((msg) => (
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
                    
                    <div class={`px-4 py-3 ${props.isInCall() ? '' : 'rounded-b-2xl'}`}>
                        <div class="flex gap-2">
                            <input 
                                type="text" 
                                class="flex-1 px-4 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent"
                                placeholder="Type a message..."
                                value={props.messageInput()}
                                onInput={(e: any) => props.onMessageInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && props.onSendMessage()}
                            />
                            <button 
                                class="px-6 py-3 bg-blue-600/80 backdrop-blur-sm text-white rounded-full hover:bg-blue-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105"
                                onClick={props.onSendMessage}
                                disabled={!props.messageInput().trim() || props.connectionStatus() !== 'connected'}
                            >
                                Send
                            </button>
                        </div>
                        {props.connectionStatus() !== 'connected' && (
                            <div class="text-xs text-red-400 mt-1">
                                Connection not ready
                            </div>
                        )}
                        {props.callStatus() === 'calling' && (
                            <div class="text-xs text-yellow-400 mt-1 animate-pulse">
                                Calling... waiting for response
                            </div>
                        )}
                        {props.callStatus() === 'ringing' && (
                            <div class="text-xs text-green-400 mt-1 animate-pulse">
                                Incoming call - check call popup
                            </div>
                        )}
                    </div>
                </div>
    );
}