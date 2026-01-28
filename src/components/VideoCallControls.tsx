interface VideoCallControlsProps {
    isAudioMuted: () => boolean;
    isVideoMuted: () => boolean;
    toggleAudioMute: () => void;
    toggleVideoMute: () => void;
    endCall: () => void;
}

const VideoOffIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
);

const AudioOffIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
);

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

export default function VideoCallControls(props: VideoCallControlsProps) {
    return (
        <div class="flex items-center justify-center gap-6">
            <button
                onClick={props.toggleAudioMute}
                class={`w-14 h-14 rounded-full backdrop-blur-sm flex items-center justify-center text-white transition-all transform hover:scale-105 ${
                    props.isAudioMuted() 
                        ? 'bg-red-500/80 hover:bg-red-500' 
                        : 'bg-white/20 hover:bg-white/30'
                }`}
                title={props.isAudioMuted() ? "Unmute microphone" : "Mute microphone"}
            >
                {props.isAudioMuted() ? <AudioOffIcon /> : <AudioIcon />}
            </button>
            
            <button
                onClick={props.endCall}
                class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-all transform hover:scale-105 shadow-xl"
                title="End call"
            >
                <div class="w-8 h-8 bg-white rounded-sm"></div>
            </button>
            
            <button
                onClick={props.toggleVideoMute}
                class={`w-14 h-14 rounded-full backdrop-blur-sm flex items-center justify-center text-white transition-all transform hover:scale-105 ${
                    props.isVideoMuted() 
                        ? 'bg-red-500/80 hover:bg-red-500' 
                        : 'bg-white/20 hover:bg-white/30'
                }`}
                title={props.isVideoMuted() ? "Turn on camera" : "Turn off camera"}
            >
                {props.isVideoMuted() ? <VideoOffIcon /> : <VideoIcon />}
            </button>
        </div>
    );
}