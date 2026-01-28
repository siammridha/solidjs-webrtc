import { createSignal, onCleanup } from 'solid-js';

interface LogsProps {
    log: () => string[];
}

export default function Logs(props: LogsProps) {
    const [logsPos, setLogsPos] = createSignal({ x: window.innerWidth - 400, y: 40 });
    const [dragging, setDragging] = createSignal(false);
    const dragOffset = { x: 0, y: 0 };

    function onLogsPointerDown(e: PointerEvent): void {
        setDragging(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        (e.target as Element)?.setPointerCapture?.((e as any).pointerId);
        e.stopPropagation();
    }

    function onLogsPointerMove(e: PointerEvent): void {
        if (!dragging()) return;
        
        const maxX = window.innerWidth - 360;
        const newX = Math.max(0, Math.min(maxX, e.clientX - dragOffset.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 320, e.clientY - dragOffset.y));
        
        setLogsPos({ x: newX, y: newY });
    }

    function onLogsPointerUp(): void {
        setDragging(false);
    }

    window.addEventListener('pointermove', onLogsPointerMove as any);
    window.addEventListener('pointerup', onLogsPointerUp as any);
    onCleanup(() => {
        window.removeEventListener('pointermove', onLogsPointerMove as any);
        window.removeEventListener('pointerup', onLogsPointerUp as any);
    });

    return (
        <div
            class="fixed bg-white border rounded shadow z-50"
            style={{ 
                left: logsPos().x + 'px',
                top: logsPos().y + 'px', 
                width: '360px' 
            }}
        >
            <div class="px-3 py-2 bg-gray-100 border-b cursor-grab flex items-center justify-between" onPointerDown={(e:any)=>onLogsPointerDown(e)}>
                <div class="text-sm font-medium">Logs</div>
                <div class="text-xs text-gray-600">
                    <button class="px-2 py-1" onClick={() => setLogsPos({ x: window.innerWidth - 400, y: 40 })}>Reset</button>
                </div>
            </div>
            <div class="h-80 p-2 overflow-auto" id="logs-container">
                {props.log().map((l) => (
                    <div class="text-xs text-gray-700">{l}</div>
                ))}
            </div>
        </div>
    );
}