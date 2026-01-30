import RemoteVideo from './RemoteVideo';
import LocalVideo from './LocalVideo';
import VideoCallControls from './VideoCallControls';

interface VideoCallProps {
    localStream: () => MediaStream | null;
    remoteStream: () => MediaStream | null;
    isVideoMuted: () => boolean;
    isAudioMuted: () => boolean;
    connectionStatus: () => 'disconnected' | 'connecting' | 'connected';
    toggleAudioMute: () => void;
    toggleVideoMute: () => void;
    endCall: () => void;
}

function ConnectionStatusIndicator(props: { status: 'disconnected' | 'connecting' | 'connected' }) {
    return (
        <div class={`w-2 h-2 rounded-full ${
            props.status === 'connected' ? 'bg-green-500' : 
            props.status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
            'bg-gray-400'
        }`} title={props.status} />
    );
}

export default function VideoCall(props: VideoCallProps) {
    return (
        <div class="fixed inset-0 z-50 bg-black">
            <RemoteVideo
                remoteStream={props.remoteStream}
                callStatus={() => 'active'}
                variant="fullscreen"
            />
            <LocalVideo
                localStream={props.localStream}
                isVideoMuted={props.isVideoMuted}
                isInCall={() => true}
                variant="pip"
            />
            <div class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-6 z-20">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="font-medium text-white">Chat</div>
                        <div class="flex items-center gap-1">
                            <ConnectionStatusIndicator status={props.connectionStatus()} />
                        </div>
                    </div>
                </div>
            </div>
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-6 z-20">
                <VideoCallControls
                    isAudioMuted={props.isAudioMuted}
                    isVideoMuted={props.isVideoMuted}
                    toggleAudioMute={props.toggleAudioMute}
                    toggleVideoMute={props.toggleVideoMute}
                    endCall={props.endCall}
                />
            </div>
        </div>
    );
}