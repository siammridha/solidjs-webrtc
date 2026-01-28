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
    const hasLocalSDP = () => props.localSDP().length > 0;
    const hasRemoteSDP = () => props.remoteSDP().length > 0;

    return (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            <div class="w-full max-w-6xl mx-auto p-4 md:p-8">
                {/* Header */}
                <div class="text-center mb-8">
                    <div class="inline-flex items-center gap-2 mb-3">
                        <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                        <div class="w-3 h-3 bg-yellow-500 rounded-full animate-pulse delay-75"></div>
                        <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse delay-150"></div>
                    </div>
                    <h1 class="text-3xl font-bold text-white mb-2">WebRTC Connection</h1>
                    <p class="text-gray-300">Exchange Session Description Protocol (SDP) to establish connection</p>
                </div>

                {/* Connection Flow Indicator */}
                <div class="flex items-center justify-center mb-8">
                    <div class="flex items-center space-x-4">
                        <div class={`flex flex-col items-center ${hasLocalSDP() ? 'text-green-400' : 'text-gray-500'}`}>
                            <div class={`w-12 h-12 rounded-full border-2 ${hasLocalSDP() ? 'bg-green-500 border-green-400' : 'border-gray-600'} flex items-center justify-center transition-all duration-300`}>
                                <span class="text-white font-bold">1</span>
                            </div>
                            <span class="text-xs mt-1">Create Offer</span>
                        </div>
                        <div class={`w-16 h-0.5 ${hasLocalSDP() && hasRemoteSDP() ? 'bg-green-400' : 'bg-gray-600'} transition-all duration-300`}></div>
                        <div class={`flex flex-col items-center ${hasRemoteSDP() ? 'text-green-400' : 'text-gray-500'}`}>
                            <div class={`w-12 h-12 rounded-full border-2 ${hasRemoteSDP() ? 'bg-green-500 border-green-400' : 'border-gray-600'} flex items-center justify-center transition-all duration-300`}>
                                <span class="text-white font-bold">2</span>
                            </div>
                            <span class="text-xs mt-1">Exchange SDP</span>
                        </div>
                        <div class={`w-16 h-0.5 ${hasLocalSDP() && hasRemoteSDP() ? 'bg-green-400' : 'bg-gray-600'} transition-all duration-300`}></div>
                        <div class={`flex flex-col items-center ${hasLocalSDP() && hasRemoteSDP() ? 'text-green-400' : 'text-gray-500'}`}>
                            <div class={`w-12 h-12 rounded-full border-2 ${hasLocalSDP() && hasRemoteSDP() ? 'bg-green-500 border-green-400' : 'border-gray-600'} flex items-center justify-center transition-all duration-300`}>
                                <span class="text-white font-bold">3</span>
                            </div>
                            <span class="text-xs mt-1">Connect</span>
                        </div>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div class="grid md:grid-cols-2 gap-6">
                    {/* Local SDP Section */}
                    <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 shadow-2xl">
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex items-center gap-2">
                                <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <h2 class="text-xl font-semibold text-white">Your SDP</h2>
                                {hasLocalSDP() && <span class="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full">Generated</span>}
                            </div>
                            <button 
                                class={`px-4 py-2 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 ${
                                    hasLocalSDP() 
                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-lg hover:shadow-green-500/25'
                                }`}
                                disabled={hasLocalSDP()}
                                onClick={async () => {
                                    try {
                                        await props.onCreateOffer();
                                        props.appendLog('Local SDP created');
                                    } catch (e) {
                                        props.appendLog('Failed to create offer: ' + String(e));
                                    }
                                }}
                            >
                                {hasLocalSDP() ? 'Generated' : 'Create Offer'}
                            </button>
                        </div>
                        
                        <div class="relative">
                            <textarea 
                                class={`w-full h-48 p-4 rounded-lg font-mono text-sm leading-relaxed resize-none transition-all duration-200 ${
                                    hasLocalSDP() 
                                        ? 'bg-white/5 text-green-300 border border-green-500/30' 
                                        : 'bg-gray-800/50 text-gray-400 border border-gray-600/50'
                                }`}
                                value={props.localSDP() || (hasLocalSDP() ? '' : 'Click "Create Offer" to generate your SDP...')}
                                readonly
                                placeholder="Your SDP will appear here..."
                            />
                            {hasLocalSDP() && (
                                <button 
                                    class={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 ${
                                        props.copied() 
                                            ? 'bg-green-500 text-white' 
                                            : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                                    }`}
                                    onClick={props.onCopyLocalSDP}
                                >
                                    {props.copied() ? '✓ Copied' : '📋 Copy'}
                                </button>
                            )}
                        </div>
                        
                        {hasLocalSDP() && (
                            <div class="mt-3 flex items-center gap-2 text-xs text-gray-300">
                                <span>💡 Share this SDP with your peer</span>
                            </div>
                        )}
                    </div>

                    {/* Remote SDP Section */}
                    <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 shadow-2xl">
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex items-center gap-2">
                                <div class="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                                <h2 class="text-xl font-semibold text-white">Peer's SDP</h2>
                                {hasRemoteSDP() && <span class="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full">Received</span>}
                            </div>
                            <button 
                                class={`px-4 py-2 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 ${
                                    !hasRemoteSDP() 
                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-lg hover:shadow-blue-500/25'
                                }`}
                                disabled={!hasRemoteSDP()}
                                onClick={async () => {
                                    if (props.remoteSDP()) {
                                        await props.onApplyRemoteSDP();
                                        props.appendLog('Remote SDP applied');
                                    }
                                }}
                            >
                                {hasRemoteSDP() ? 'Connect' : 'Waiting...'}
                            </button>
                        </div>
                        
                        <div class="relative">
                            <textarea 
                                class={`w-full h-48 p-4 rounded-lg font-mono text-sm leading-relaxed resize-none transition-all duration-200 cursor-text ${
                                    hasRemoteSDP() 
                                        ? 'bg-white/5 text-blue-300 border border-blue-500/30' 
                                        : 'bg-gray-800/50 text-gray-300 border border-gray-600/50 hover:border-gray-500/50'
                                }`}
                                placeholder="Paste your peer's SDP here... (Click to auto-paste)"
                                value={props.remoteSDP()}
                                onInput={(e: any) => props.onRemoteSDPChange(e.target.value)}
                                onClick={props.onAutoPaste}
                            />
                            {!hasRemoteSDP() && (
                                <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div class="text-center text-gray-400">
                                        <div class="text-2xl mb-2">📥</div>
                                        <p class="text-sm">Click to auto-paste from clipboard</p>
                                        <p class="text-xs mt-1">or paste manually</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {hasRemoteSDP() && (
                            <div class="mt-3 flex items-center gap-2 text-xs text-gray-300">
                                <span>🔗 Ready to establish connection</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Help Section */}
                <div class="mt-8 text-center">
                    <div class="inline-flex items-center gap-2 text-xs text-gray-400 bg-white/5 px-4 py-2 rounded-full backdrop-blur-sm">
                        <span>ℹ️</span>
                        <span>Step 1: Create Offer → Step 2: Exchange SDPs → Step 3: Connect</span>
                    </div>
                </div>
            </div>
        </div>
    );
}