interface SDPExchangeProps {
    localSDP: () => string;
    remoteSDP: () => string;
    copied: () => boolean;
    onCreateOffer: () => Promise<void>;
    onCopyLocalSDP: () => Promise<void>;
    onRemoteSDPChange: (value: string) => void;
    onApplyRemoteSDP: () => Promise<void>;
    onAutoPaste: () => Promise<void>;
    appendLog: (message: string) => void;
}

export default function SDPExchange(props: SDPExchangeProps) {
    return (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900">
            <div class="w-full h-full p-6 overflow-auto">
                        <div class="mb-2">
                            <h2 class="text-lg font-semibold text-gray-100">
                                SDP Exchange
                            </h2>
                        </div>
                        
                        {/* Local SDP Display */}
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <label class="block text-sm font-medium text-gray-200">Local SDP</label>
                                <button 
                                    class="px-3 py-1 bg-green-600 text-white rounded disabled:bg-gray-600 hover:bg-green-700 transition-colors" 
                                    onClick={async () => {
                                        try {
                                            await props.onCreateOffer();
                                            props.appendLog('Local SDP created');
                                        } catch (e) {
                                            props.appendLog('Failed to create offer: ' + String(e));
                                        }
                                    }}
                                >
                                    Create Offer
                                </button>
                            </div>
                            <div class="flex gap-2">
                                <textarea class="flex-1 h-64 p-2 border border-gray-600 rounded bg-gray-800 text-gray-100 font-mono text-sm" value={props.localSDP()} readonly />
                                <button class="px-3 py-1 bg-indigo-600 text-white rounded self-start hover:bg-indigo-700 transition-colors" onClick={props.onCopyLocalSDP}>{props.copied() ? 'Copied' : 'Copy'}</button>
                            </div>
                        </div>

                        {/* Remote SDP Input */}
                        <div class="mb-4">
                            <label class="block text-sm font-medium mb-2 text-gray-200">Remote SDP</label>
                            <textarea 
                                class="w-full h-32 p-2 border border-gray-600 rounded mb-2 bg-gray-800 text-gray-100 font-mono text-sm placeholder-gray-400" 
                                placeholder="Paste remote SDP here... (Click to auto-paste)"
                                value={props.remoteSDP()}
                                onInput={(e: any) => props.onRemoteSDPChange(e.target.value)}
                                onClick={props.onAutoPaste}
                            />
                            <button 
                                class="px-3 py-1 bg-green-600 text-white rounded mr-2 hover:bg-green-700 transition-colors" 
                                onClick={async () => {
                                    if (props.remoteSDP()) {
                                        await props.onApplyRemoteSDP();
                                        props.appendLog('Remote SDP applied');
                                    }
                                }}
                            >
                                Set Remote SDP
                            </button>
                        </div>

                </div>

        </div>
    );
}