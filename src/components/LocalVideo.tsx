interface LocalVideoProps {
    localStream: () => MediaStream | null;
    isVideoMuted: () => boolean;
    isInCall: () => boolean;
    variant: 'fullscreen' | 'pip' | 'chat-pip';
}

const VideoOffIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
);

export default function LocalVideo(props: LocalVideoProps) {
    const getVideoClasses = () => {
        switch (props.variant) {
            case 'fullscreen':
                return 'absolute inset-0 w-full h-full object-cover';
            case 'pip':
                return 'w-full h-full object-cover';
            case 'chat-pip':
                return 'w-full h-full object-contain';
            default:
                return 'w-full h-full object-cover';
        }
    };

    const getContainerClasses = () => {
        switch (props.variant) {
            case 'fullscreen':
                return 'fixed inset-0 z-50 bg-black';
            case 'pip':
                return 'absolute top-4 right-4 w-48 bg-black/80 backdrop-blur-sm rounded-2xl overflow-hidden shadow-2xl border border-white/10';
            case 'chat-pip':
                return 'absolute bottom-2 right-2 w-24 bg-black/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/10';
            default:
                return '';
        }
    };

    const getContainerStyle = () => {
        return props.variant === 'pip' ? { 'aspect-ratio': 'auto' } : {};
    };

    return (
        <>
            {props.localStream() && (
                <div class={getContainerClasses()} style={getContainerStyle()}>
                    {props.isVideoMuted() ? (
                        <div class="w-full h-full flex items-center justify-center bg-gray-900/90 backdrop-blur-sm">
                            <div class="text-white/80 text-center">
                                <VideoOffIcon class={props.variant === 'chat-pip' ? 'w-6 h-6' : 'w-12 h-12'} />
                                <div class={props.variant === 'chat-pip' ? 'text-xs' : 'text-sm'}>Camera Off</div>
                            </div>
                        </div>
                    ) : (
                        <video 
                            id={props.variant === 'pip' ? 'local-video-pip' : undefined}
                            class={getVideoClasses()}
                            autoplay
                            muted
                            playsinline
                            controls={false}
                        />
                    )}
                </div>
            )}
        </>
    );
}