interface RemoteVideoProps {
    remoteStream: () => MediaStream | null;
    callStatus: () => 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ending';
    variant: 'fullscreen' | 'chat';
}

export default function RemoteVideo(props: RemoteVideoProps) {
    const getVideoClasses = () => {
        switch (props.variant) {
            case 'fullscreen':
                return 'w-full h-full object-cover';
            case 'chat':
                return 'w-full h-full object-cover';
            default:
                return 'w-full h-full object-cover';
        }
    };

    const getContainerClasses = () => {
        switch (props.variant) {
            case 'fullscreen':
                return 'absolute inset-0 w-full h-full';
            case 'chat':
                return 'relative h-48';
            default:
                return '';
        }
    };

    const getStatusText = () => {
        switch (props.callStatus()) {
            case 'connecting':
                return 'Connecting...';
            case 'ringing':
                return 'Ringing...';
            default:
                return 'Waiting for remote video...';
        }
    };

    return (
        <div class={getContainerClasses()}>
            <video 
                id={props.variant === 'fullscreen' ? 'remote-video-fullscreen' : undefined}
                class={getVideoClasses()}
                autoplay
                playsinline
                muted={false}
                controls={false}
                disablepictureinpicture={props.variant === 'fullscreen'}
            />
            
            {!props.remoteStream() && (
                <div class="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div class="text-white text-xl">
                        {getStatusText()}
                    </div>
                </div>
            )}

            {props.variant === 'chat' && (
                <div class="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1 border border-white/10">
                    <div class={`w-2 h-2 rounded-full ${
                        props.callStatus() === 'active' ? 'bg-green-500 animate-pulse' :
                        props.callStatus() === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                        'bg-red-500'
                    }`}></div>
                    {props.callStatus() === 'connecting' ? 'Connecting...' : 
                     props.callStatus() === 'active' ? 'Live' : 
                     props.callStatus() === 'ringing' ? 'Ringing...' : 
                     'Ready'}
                </div>
            )}
        </div>
    );
}