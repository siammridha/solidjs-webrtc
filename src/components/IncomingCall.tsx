interface IncomingCallProps {
    onAccept: () => void;
    onDecline: () => void;
}

const VideoIcon = (props: { class?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" class={props.class || "w-6 h-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

export default function IncomingCall(props: IncomingCallProps) {
    return (
        <div class="fixed inset-0 z-40 flex items-center justify-center" style={{ 'background-color': 'rgba(0, 0, 0, 0.3)' }}>
            <div class="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                <div class="text-center mb-4">
                    <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <VideoIcon class="w-8 h-8 text-green-600" />
                    </div>
                    <h3 class="text-lg font-semibold mb-1">Incoming Video Call</h3>
                    <p class="text-gray-600">Someone is calling you</p>
                </div>
                        
                        <div class="flex gap-3 justify-center">
                            <button
                                onClick={props.onAccept}
                                class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                                Accept
                            </button>
                            <button
                                onClick={props.onDecline}
                                class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Decline
                            </button>
                        </div>
                    </div>
                </div>
    );
}