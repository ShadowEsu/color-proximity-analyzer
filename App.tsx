
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ColorData, ComparisonRecord, ComparisonMetrics } from './types';
import { rgbToLab, calculateMetrics, rgbToHex, getRepresentativeColor, createThumbnail } from './utils/colorMath';
import { saveRecord, getAllRecords, deleteRecord, clearAllRecords } from './utils/db';

// --- Sub-components ---

const ColorSwatch: React.FC<{ color: ColorData; label: string; onAction?: () => void; actionLabel?: string }> = ({ color, label, onAction, actionLabel }) => (
  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center group">
    <div className="w-16 h-16 rounded-lg border border-slate-300 shadow-inner mb-2 transition-transform group-hover:scale-105" style={{ backgroundColor: color.hex }} />
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
    <span className="text-sm font-mono text-slate-700 mt-1 uppercase">{color.hex}</span>
    {onAction && (
      <button 
        onClick={onAction}
        className="mt-3 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[10px] font-bold uppercase transition-colors"
      >
        {actionLabel || 'Change'}
      </button>
    )}
  </div>
);

const App: React.FC = () => {
  // --- Capture State ---
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [refA, setRefA] = useState<{ name: string; color: ColorData | null }>({ name: 'Reference A', color: null });
  const [refB, setRefB] = useState<{ name: string; color: ColorData | null }>({ name: 'Reference B', color: null });
  const [sample, setSample] = useState<ColorData | null>(null);
  const [tempColor, setTempColor] = useState<ColorData | null>(null);
  
  // --- History State ---
  const [history, setHistory] = useState<ComparisonRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'liked' | 'disliked'>('all');
  const [isSaving, setIsSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);

  // Region Selection State
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    loadHistory();
    startCamera();
    return () => stopCamera();
  }, []);

  // Fix: Re-attach stream whenever the video element mounts (e.g. after Retake)
  useEffect(() => {
    if (stream && videoRef.current && !capturedImage) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, capturedImage]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(mediaStream);
    } catch (err) {
      console.error("Camera error:", err);
      alert("Camera access denied or unavailable.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const loadHistory = async () => {
    const records = await getAllRecords();
    setHistory(records);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    
    // Ensure video has actual dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn("Video stream dimensions are 0. Waiting for metadata...");
      return;
    }

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(dataUrl);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setTempColor(null);
    setSelectionRect(null);
  };

  const startSelection = (e: React.MouseEvent | React.TouchEvent) => {
    if (!capturedImage) return;
    const rect = selectionCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setIsSelecting(true);
    setSelectionRect({ x: clientX - rect.left, y: clientY - rect.top, w: 0, h: 0 });
  };

  const updateSelection = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isSelecting || !selectionRect) return;
    const rect = selectionCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setSelectionRect(prev => prev ? ({
      ...prev,
      w: (clientX - rect.left) - prev.x,
      h: (clientY - rect.top) - prev.y
    }) : null);
  };

  const endSelection = () => {
    setIsSelecting(false);
    if (!selectionRect || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const sCanvas = selectionCanvasRef.current;
    if (!sCanvas) return;

    const scaleX = canvas.width / sCanvas.clientWidth;
    const scaleY = canvas.height / sCanvas.clientHeight;

    const x = Math.min(selectionRect.x, selectionRect.x + selectionRect.w) * scaleX;
    const y = Math.min(selectionRect.y, selectionRect.y + selectionRect.h) * scaleY;
    const w = Math.abs(selectionRect.w) * scaleX;
    const h = Math.abs(selectionRect.h) * scaleY;

    if (w < 2 || h < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.getImageData(x, y, w, h);
    const { median, average } = getRepresentativeColor(imgData.data);
    
    const color: ColorData = {
      hex: rgbToHex(median),
      rgb: median,
      lab: rgbToLab(median),
      avgRgb: average
    };
    setTempColor(color);
  };

  const saveToRef = (slot: 'A' | 'B') => {
    if (!tempColor) return;
    if (slot === 'A') setRefA(prev => ({ ...prev, color: tempColor }));
    else setRefB(prev => ({ ...prev, color: tempColor }));
    setTempColor(null);
    setSelectionRect(null);
  };

  const useAsSample = () => {
    if (!tempColor) return;
    setSample(tempColor);
    setTempColor(null);
    setSelectionRect(null);
  };

  const metrics = useMemo(() => {
    if (!refA.color || !refB.color || !sample) return null;
    return calculateMetrics(sample, refA.color, refB.color);
  }, [refA.color, refB.color, sample]);

  const handleSaveComparison = async () => {
    if (!refA.color || !refB.color || !sample || !metrics) return;
    setIsSaving(true);
    
    const thumbnail = await createThumbnail(capturedImage!);

    const record: ComparisonRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      title: `Comparison - ${new Date().toLocaleString()}`,
      refA: { name: refA.name, color: refA.color },
      refB: { name: refB.name, color: refB.color },
      sample: sample,
      metrics,
      notes: '',
      feedback: null,
      thumbnail
    };

    await saveRecord(record);
    await loadHistory();
    setIsSaving(false);
  };

  const handleUpdateRecord = async (record: ComparisonRecord) => {
    await saveRecord(record);
    await loadHistory();
  };

  const handleRecheck = async (record: ComparisonRecord) => {
    const newMetrics = calculateMetrics(record.sample, record.refA.color, record.refB.color);
    const updatedRecord = {
      ...record,
      lastCheckedAt: Date.now(),
      previousMetrics: record.metrics,
      metrics: newMetrics
    };
    await handleUpdateRecord(updatedRecord);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this record?')) {
      await deleteRecord(id);
      loadHistory();
    }
  };

  const handleClearAll = async () => {
    if (confirm('Clear all history permanently?')) {
      await clearAllRecords();
      loadHistory();
    }
  };

  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const matchesSearch = (item.title || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
                           (item.notes || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filter === 'all' || 
                           (filter === 'liked' && item.feedback === 'liked') ||
                           (filter === 'disliked' && item.feedback === 'disliked');
      return matchesSearch && matchesFilter;
    });
  }, [history, searchQuery, filter]);

  const exportCSV = () => {
    const headers = ["ID", "Timestamp", "Title", "RefA_Name", "RefA_Hex", "RefB_Name", "RefB_Hex", "Sample_Hex", "DeltaE_A", "DeltaE_B", "TowardA_Pct", "TowardB_Pct", "Feedback", "Notes"];
    const rows = history.map(r => [
      r.id,
      new Date(r.timestamp).toISOString(),
      r.title,
      r.refA.name,
      r.refA.color.hex,
      r.refB.name,
      r.refB.color.hex,
      r.sample.hex,
      r.metrics.dA.toFixed(3),
      r.metrics.dB.toFixed(3),
      r.metrics.towardA.toFixed(1),
      r.metrics.towardB.toFixed(1),
      r.feedback || 'unrated',
      (r.notes || "").replace(/,/g, ';')
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chroma_compare_${Date.now()}.csv`;
    a.click();
  };

  const exportJSON = () => {
    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chroma_compare_${Date.now()}.json`;
    a.click();
  };

  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as ComparisonRecord[];
        for (const record of imported) {
          await saveRecord(record);
        }
        loadHistory();
        alert('Data imported successfully.');
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen flex flex-col max-w-5xl mx-auto bg-slate-50 font-sans text-slate-900">
      
      {/* Header */}
      <header className="bg-slate-900 text-white p-6 flex justify-between items-center shadow-lg">
        <div>
          <h1 className="text-2xl font-black tracking-tighter uppercase italic">ChromaCompare</h1>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Perceptual Color Analysis v2.0</p>
        </div>
        <div className="hidden md:flex gap-4">
           <div className="text-right">
             <div className="text-xs font-bold text-slate-400 uppercase">Records</div>
             <div className="text-xl font-black text-indigo-400">{history.length}</div>
           </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <section className="p-6 space-y-8">
          
          {/* Main Comparison Tool */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Capture Section */}
            <div className="lg:col-span-7 space-y-6">
              <div className="relative aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-white group">
                {!capturedImage ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-center">
                       <button onClick={captureFrame} className="bg-white text-slate-900 px-8 py-4 rounded-full font-black text-lg uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all">
                         Capture
                       </button>
                    </div>
                  </>
                ) : (
                  <div className="relative w-full h-full">
                    <img src={capturedImage} className="w-full h-full object-contain bg-slate-900" alt="Captured" />
                    <canvas ref={selectionCanvasRef} onMouseDown={startSelection} onMouseMove={updateSelection} onMouseUp={endSelection} onTouchStart={startSelection} onTouchMove={updateSelection} onTouchEnd={endSelection} className="absolute inset-0 w-full h-full cursor-crosshair z-10" />
                    {selectionRect && (
                      <div className="absolute border-2 border-white bg-indigo-500/30 z-20 pointer-events-none shadow-[0_0_20px_rgba(255,255,255,0.5)]"
                        style={{ left: Math.min(selectionRect.x, selectionRect.x + selectionRect.w), top: Math.min(selectionRect.y, selectionRect.y + selectionRect.h), width: Math.abs(selectionRect.w), height: Math.abs(selectionRect.h) }}
                      />
                    )}
                    <button onClick={handleRetake} className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-black/80 transition-all z-30">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              {tempColor && (
                <div className="bg-indigo-600 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-center gap-6 animate-in slide-in-from-bottom duration-500">
                  <div className="w-24 h-24 rounded-2xl border-8 border-white shadow-lg shrink-0" style={{ backgroundColor: tempColor.hex }} />
                  <div className="flex-1 text-center md:text-left">
                    <div className="text-white text-xs font-black uppercase tracking-widest opacity-70">Current selection</div>
                    <div className="text-white text-3xl font-black font-mono tracking-tighter uppercase">{tempColor.hex}</div>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button onClick={() => saveToRef('A')} className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl text-xs font-bold uppercase transition-all">Ref A</button>
                    <button onClick={() => saveToRef('B')} className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl text-xs font-bold uppercase transition-all">Ref B</button>
                    <button onClick={useAsSample} className="bg-white text-indigo-700 hover:bg-slate-100 px-6 py-2 rounded-xl text-xs font-black uppercase transition-all shadow-lg">Sample</button>
                  </div>
                </div>
              )}
            </div>

            {/* References & Results Area */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Active References */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                 <div className="flex items-center justify-between mb-4">
                   <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Setup</h2>
                   {(!refA.color || !refB.color) && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold uppercase">Awaiting Refs</span>}
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    {refA.color ? (
                      <ColorSwatch color={refA.color} label={refA.name} onAction={() => setRefA({ ...refA, color: null })} actionLabel="Clear" />
                    ) : (
                      <div className="h-32 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300 text-[10px] font-bold uppercase p-4 text-center">Set A</div>
                    )}
                    {refB.color ? (
                      <ColorSwatch color={refB.color} label={refB.name} onAction={() => setRefB({ ...refB, color: null })} actionLabel="Clear" />
                    ) : (
                      <div className="h-32 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300 text-[10px] font-bold uppercase p-4 text-center">Set B</div>
                    )}
                 </div>
              </div>

              {/* Live Result */}
              <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl text-white space-y-6">
                 {sample ? (
                   <>
                    <div className="flex items-center gap-6">
                       <div className="w-20 h-20 rounded-2xl border-4 border-slate-700 shadow-inner" style={{ backgroundColor: sample.hex }} />
                       <div className="flex-1">
                          <div className="text-[10px] font-black text-indigo-400 uppercase tracking-[.2em] mb-1">SAMPLE MATCH</div>
                          {metrics ? (
                             <div className="text-3xl font-black tracking-tighter uppercase italic leading-none">
                                {metrics.towardA > metrics.towardB ? refA.name : refB.name}
                             </div>
                          ) : (
                             <div className="text-sm text-slate-500 font-bold italic">Select Ref A & B</div>
                          )}
                       </div>
                    </div>

                    {metrics && (
                      <div className="space-y-6 animate-in fade-in duration-700">
                        <div className="relative h-14 bg-slate-800 rounded-2xl overflow-hidden flex border-2 border-slate-700">
                           <div className="bg-indigo-600 h-full flex items-center pl-4 transition-all duration-1000 ease-out" style={{ width: `${metrics.towardA}%` }}>
                             <span className="text-xs font-black">{Math.round(metrics.towardA)}%</span>
                           </div>
                           <div className="bg-slate-700 h-full flex items-center justify-end pr-4 transition-all duration-1000 ease-out flex-1">
                             <span className="text-xs font-black">{Math.round(metrics.towardB)}%</span>
                           </div>
                           <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                              <span className="text-[8px] font-black uppercase opacity-40">Ref A</span>
                              <span className="text-[8px] font-black uppercase opacity-40">Ref B</span>
                           </div>
                        </div>

                        <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase tracking-widest">
                           <div>ΔE A: {metrics.dA.toFixed(2)}</div>
                           <div className={`px-2 py-0.5 rounded ${metrics.separationLabel === 'Strong' ? 'bg-indigo-500 text-white' : 'bg-slate-700'}`}>
                             {metrics.separationLabel} Choice
                           </div>
                           <div>ΔE B: {metrics.dB.toFixed(2)}</div>
                        </div>

                        <button onClick={handleSaveComparison} disabled={isSaving} className="w-full bg-white text-slate-900 py-4 rounded-2xl font-black uppercase tracking-[.2em] shadow-xl hover:bg-slate-100 transition-all active:scale-95 disabled:opacity-50">
                           {isSaving ? 'Processing...' : 'Save Record'}
                        </button>
                      </div>
                    )}
                   </>
                 ) : (
                   <div className="py-12 flex flex-col items-center justify-center text-slate-600">
                      <div className="w-16 h-16 border-4 border-slate-800 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Sample Selection</p>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </section>

        {/* History Section */}
        <section className="bg-white border-t-8 border-slate-100 p-6 md:p-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
            <div>
              <h2 className="text-3xl font-black tracking-tighter uppercase italic leading-none">History</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Found {filteredHistory.length} comparisons</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
               <input 
                 type="text" 
                 placeholder="SEARCH HISTORY..." 
                 className="bg-slate-100 border-none rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest focus:ring-2 focus:ring-indigo-500"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
               />
               <div className="flex bg-slate-100 rounded-xl p-1">
                 {(['all', 'liked', 'disliked'] as const).map(f => (
                   <button 
                     key={f}
                     onClick={() => setFilter(f)}
                     className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${filter === f ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-900'}`}
                   >
                     {f}
                   </button>
                 ))}
               </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 mb-8">
            <button onClick={exportCSV} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              CSV
            </button>
            <button onClick={exportJSON} className="bg-slate-100 text-slate-900 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2">
              JSON
            </button>
            <label className="bg-slate-100 text-slate-900 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2 cursor-pointer">
              IMPORT
              <input type="file" className="hidden" accept=".json" onChange={importJSON} />
            </label>
            <button onClick={handleClearAll} className="ml-auto bg-red-50 text-red-600 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all">
              Clear All
            </button>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="py-32 text-center text-slate-300">
               <div className="text-5xl mb-4 font-black">∅</div>
               <p className="text-xs font-black uppercase tracking-widest">No entries matching criteria</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {filteredHistory.map(record => (
                 <div key={record.id} className="bg-white border-2 border-slate-100 rounded-[2rem] overflow-hidden hover:border-indigo-200 transition-all group flex flex-col h-full shadow-sm hover:shadow-xl">
                   <div className="relative aspect-video bg-slate-900 shrink-0">
                     <img src={record.thumbnail} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="Thumb" />
                     <div className="absolute top-4 left-4 flex gap-2">
                       <div className="w-8 h-8 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: record.refA.color.hex }} />
                       <div className="w-8 h-8 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: record.refB.color.hex }} />
                       <div className="w-8 h-8 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: record.sample.hex }} />
                     </div>
                     <button onClick={() => handleDelete(record.id)} className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                     </button>
                   </div>
                   
                   <div className="p-6 flex-1 flex flex-col space-y-4">
                     <div>
                       <input 
                         type="text" 
                         value={record.title}
                         onChange={(e) => handleUpdateRecord({ ...record, title: e.target.value })}
                         className="w-full text-lg font-black tracking-tight uppercase italic bg-transparent border-none p-0 focus:ring-0 truncate"
                       />
                       <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{new Date(record.timestamp).toLocaleString()}</span>
                          {record.lastCheckedAt && <span className="text-[8px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-black uppercase">Updated</span>}
                       </div>
                     </div>

                     <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase">
                           <span className="text-indigo-600">{Math.round(record.metrics.towardA)}% Ref A</span>
                           <span className="text-slate-400">{Math.round(record.metrics.towardB)}% Ref B</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                           <div className="bg-indigo-600 h-full" style={{ width: `${record.metrics.towardA}%` }} />
                           <div className="bg-slate-300 h-full flex-1" />
                        </div>
                     </div>

                     <textarea 
                        className="w-full text-[11px] font-medium text-slate-600 bg-slate-50 border-none rounded-xl p-3 placeholder:text-slate-300 resize-none h-20 focus:ring-1 focus:ring-slate-200"
                        placeholder="Add observation notes..."
                        value={record.notes || ""}
                        onChange={(e) => handleUpdateRecord({ ...record, notes: e.target.value })}
                     />

                     <div className="flex items-center justify-between pt-2">
                        <div className="flex gap-1">
                           <button 
                             onClick={() => handleUpdateRecord({ ...record, feedback: record.feedback === 'liked' ? null : 'liked' })}
                             className={`p-2 rounded-xl transition-all ${record.feedback === 'liked' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 text-slate-400 hover:text-indigo-600'}`}
                           >
                             <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                           </button>
                           <button 
                             onClick={() => handleUpdateRecord({ ...record, feedback: record.feedback === 'disliked' ? null : 'disliked' })}
                             className={`p-2 rounded-xl transition-all ${record.feedback === 'disliked' ? 'bg-red-600 text-white shadow-md shadow-red-200' : 'bg-slate-50 text-slate-400 hover:text-red-600'}`}
                           >
                             <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.106-1.79l-.05-.025A4 4 0 0011.057 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z" /></svg>
                           </button>
                        </div>
                        <div className="flex gap-2">
                           <button onClick={() => handleRecheck(record)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Recheck</button>
                           <button onClick={() => {
                             setRefA({ name: record.refA.name, color: record.refA.color });
                             setRefB({ name: record.refB.name, color: record.refB.color });
                             setSample(record.sample);
                             window.scrollTo({ top: 0, behavior: 'smooth' });
                           }} className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all">Reload</button>
                        </div>
                     </div>
                   </div>
                 </div>
               ))}
            </div>
          )}
        </section>
      </main>

      <footer className="bg-slate-900 text-white p-6 border-t border-slate-800 flex flex-wrap justify-center gap-10 text-[10px] font-black uppercase tracking-[.3em]">
         <div className="flex items-center gap-2">
           <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
           CIE76 Perceptual Distances
         </div>
         <div className="flex items-center gap-2">
           <span className="w-2 h-2 rounded-full bg-indigo-500" />
           IndexedDB Storage
         </div>
         <div className="flex items-center gap-2">
           <span className="w-2 h-2 rounded-full bg-slate-500" />
           Mobile Environment Optimized
         </div>
      </footer>
    </div>
  );
};

export default App;
