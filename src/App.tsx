import * as React from 'react';
import { 
  Bike, 
  Play, 
  Square, 
  History, 
  Wrench, 
  ChevronRight, 
  MapPin, 
  Clock, 
  RotateCcw,
  Plus,
  Trash2,
  Navigation,
  Bell,
  BellOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { Trip, MotoState, MaintenanceRecord } from './types';
import { cn, formatDistance, calculateDistance } from './lib/utils';

const STORAGE_KEY = 'moto_tracker_state';

const initialState: MotoState = {
  totalKm: 0,
  trips: [],
  maintenance: [],
  lastMaintenanceKm: 0,
  monthlyGoal: 500,
  primaryColor: '#CCFF00', // Default Acid Green
  tripMeters: { a: 0, b: 0, c: 0 },
  muteAlert: false,
};

const THEME_COLORS = [
  { name: 'Acid', value: '#CCFF00' },
  { name: 'Electric', value: '#00E0FF' },
  { name: 'Blood', value: '#FF3D00' },
  { name: 'Solar', value: '#FFB800' },
  { name: 'Magenta', value: '#FF0099' },
  { name: 'White', value: '#FFFFFF' },
];

export default function App() {
  const [state, setState] = React.useState<MotoState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const data = saved ? JSON.parse(saved) : initialState;
      // Migration: ensure monthlyGoal exists
      if (data && typeof data.monthlyGoal === 'undefined') {
        data.monthlyGoal = initialState.monthlyGoal;
      }
      if (data && !data.primaryColor) {
        data.primaryColor = initialState.primaryColor;
      }
      if (data && !data.tripMeters) {
        data.tripMeters = initialState.tripMeters;
      }
      if (typeof data.muteAlert === 'undefined') {
        data.muteAlert = false;
      }
      return data;
    } catch (e) {
      console.error('Failed to parse storage', e);
      return initialState;
    }
  });

  const [activeTrip, setActiveTrip] = React.useState<Trip | null>(null);
  const [selectedTripMeter, setSelectedTripMeter] = React.useState<'a' | 'b' | 'c'>('a');
  const [view, setView] = React.useState<'dashboard' | 'history' | 'maintenance'>('dashboard');
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [trackingError, setTrackingError] = React.useState<string | null>(null);
  const [targetKmInput, setTargetKmInput] = React.useState<string>('');
  const [alertTriggered, setAlertTriggered] = React.useState(false);
  const [isAlarmRinging, setIsAlarmRinging] = React.useState(false);

  const audioContextRef = React.useRef<AudioContext | null>(null);
  const alarmNodesRef = React.useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  const wakeLockRef = React.useRef<any>(null);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.error('Wake Lock failed:', err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  const playAlertSound = (freq = 880, duration = 0.2) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      
      // Resume context if suspended (browser security)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.05);
      
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.error('Failed to play sound', e);
    }
  };

  const startContinuousAlarm = () => {
    if (state.muteAlert) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square'; // Ligar som mais "agressivo"
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      
      // Efeito de sirene/bip repetitivo
      const now = ctx.currentTime;
      for (let i = 0; i < 1000; i++) {
        osc.frequency.setValueAtTime(880, now + i * 0.5);
        osc.frequency.setValueAtTime(440, now + i * 0.5 + 0.25);
      }

      gain.gain.setValueAtTime(0.5, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      alarmNodesRef.current = { osc, gain };
      setIsAlarmRinging(true);
    } catch (e) {
      console.error('Failed to start alarm', e);
    }
  };

  const stopContinuousAlarm = () => {
    if (alarmNodesRef.current) {
      try {
        alarmNodesRef.current.osc.stop();
        alarmNodesRef.current.osc.disconnect();
        alarmNodesRef.current.gain.disconnect();
      } catch (e) {
        console.error('Error stopping alarm', e);
      }
      alarmNodesRef.current = null;
    }
    setIsAlarmRinging(false);
  };

  // Watch for active trip in local storage for crash recovery
  React.useEffect(() => {
    try {
      const savedActive = localStorage.getItem('active_trip');
      if (savedActive) {
        setActiveTrip(JSON.parse(savedActive));
      }
    } catch (e) {
      console.error('Failed to parse active trip', e);
      localStorage.removeItem('active_trip');
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Apply primary color globally
    if (state.primaryColor) {
      document.documentElement.style.setProperty('--color-moto-primary', state.primaryColor);
      // Also update shadows and accent variations if needed
    }
  }, [state]);

  React.useEffect(() => {
    if (activeTrip) {
      localStorage.setItem('active_trip', JSON.stringify(activeTrip));
    } else {
      localStorage.removeItem('active_trip');
    }
  }, [activeTrip]);

  // Tracking Logic
  React.useEffect(() => {
    let watchId: number | null = null;

    if (activeTrip && activeTrip.status === 'active') {
      // Re-request wake lock if we recovered an active trip from storage
      if (!wakeLockRef.current) {
        requestWakeLock();
      }

      if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude: lat, longitude: lng, accuracy } = position.coords;
            const now = Date.now();

            // Ignore very low accuracy points if they are too far from reality
            if (accuracy > 100) {
              setTrackingError('GPS: Baixa Precisão...');
              return;
            }
            
            setTrackingError(null);

            setActiveTrip(prev => {
              if (!prev) return null;
              
              const lastPoint = prev.points[prev.points.length - 1];
              
              if (!lastPoint) {
                return {
                  ...prev,
                  points: [{ lat, lng, timestamp: now }]
                };
              }

              const dist = calculateDistance(lastPoint.lat, lastPoint.lng, lat, lng);
              // Filter out jitter. If accuracy is 10m, we should maybe be a bit careful.
              // Motorcycles move fast, so > 3 meters is a safe bet.
              const threshold = accuracy > 30 ? 0.015 : 0.003; 

              if (dist < threshold) return prev;

              // Update persistent trip meters in global state
              setState(s => ({
                ...s,
                tripMeters: {
                  a: (s.tripMeters?.a || 0) + dist,
                  b: (s.tripMeters?.b || 0) + dist,
                  c: (s.tripMeters?.c || 0) + dist,
                }
              }));

              return {
                ...prev,
                distance: prev.distance + dist,
                points: [...prev.points, { lat, lng, timestamp: now }]
              };
            });
          },
          (error) => {
            console.error('Geolocation error:', error);
            if (error.code === 1) {
              setTrackingError('GPS: Permissão Negada (Habilite GPS)');
            } else if (error.code === 3) {
              setTrackingError('GPS: Timeout (Sinal Fraco)');
            } else {
              setTrackingError('GPS: Erro de Sinal');
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
        );
      } else {
        setTrackingError('GPS: Não suportado');
      }
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [activeTrip?.status === 'active']);

  // Check for target distance
  React.useEffect(() => {
    if (activeTrip && activeTrip.status === 'active' && activeTrip.targetDistance) {
      if (activeTrip.distance >= activeTrip.targetDistance && !alertTriggered) {
        setAlertTriggered(true);
        startContinuousAlarm();
      }
    }
  }, [activeTrip?.distance, activeTrip?.targetDistance, alertTriggered]);

  // Request location on mount to ensure permissions are handled early
  React.useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          console.log('Location access granted');
          setTrackingError(null);
        },
        (err) => {
          console.warn('Initial location check failed:', err);
          if (err.code === 1) setTrackingError('GPS: Permissão Negada');
          else if (err.code === 2) setTrackingError('GPS: Posição Indisponível');
          else if (err.code === 3) setTrackingError('GPS: Tempo Esgotado');
          else setTrackingError('GPS: Erro de Sinal');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    // Wake lock recovery on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && activeTrip?.status === 'active') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Unlock audio on first click anywhere
    const unlockAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  const startTrip = async () => {
    // Unlock audio on user interaction
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    // Proactively request geolocation on click to ensure prompt
    if ('geolocation' in navigator) {
      setTrackingError('GPS: Solicitando...');
      navigator.geolocation.getCurrentPosition(
        () => {
          setTrackingError(null);
          requestWakeLock();
          
          const target = parseFloat(targetKmInput);
          const newTrip: Trip = {
            id: crypto.randomUUID(),
            startTime: Date.now(),
            distance: 0,
            targetDistance: !isNaN(target) && target > 0 ? target : undefined,
            points: [],
            status: 'active',
          };
          setActiveTrip(newTrip);
          setAlertTriggered(false);
        },
        (error) => {
          console.error('Initial permission error:', error);
          if (error.code === 1) {
            setTrackingError('GPS: Permissão Negada (Habilite no navegador)');
          } else if (error.code === 2) {
            setTrackingError('GPS: Posição Indisponível');
          } else if (error.code === 3) {
            setTrackingError('GPS: Tempo Esgotado (Tente novamente)');
          } else {
            setTrackingError('GPS: Erro de inicialização');
          }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setTrackingError('GPS: Não suportado');
    }
  };

  const stopTrip = () => {
    if (!activeTrip) return;
    releaseWakeLock();
    stopContinuousAlarm();

    const completedTrip: Trip = {
      ...activeTrip,
      endTime: Date.now(),
      status: 'completed',
    };

    setState(prev => ({
      ...prev,
      totalKm: prev.totalKm + completedTrip.distance,
      trips: [completedTrip, ...prev.trips],
    }));
    setActiveTrip(null);
  };

  const deleteTrip = (id: string) => {
    setState(prev => ({
      ...prev,
      trips: prev.trips.filter(t => t.id !== id)
    }));
  };

  const addMaintenance = (type: MaintenanceRecord['type'], notes: string = '') => {
    const record: MaintenanceRecord = {
      id: crypto.randomUUID(),
      type,
      kilometers: state.totalKm,
      date: Date.now(),
      notes,
    };

    setState(prev => ({
      ...prev,
      maintenance: [record, ...prev.maintenance],
      lastMaintenanceKm: prev.totalKm
    }));
  };

  const resetOdo = () => {
    if (confirm('Tem certeza que deseja resetar o odômetro total?')) {
      setState(initialState);
    }
  };

  const updateOdoManual = () => {
    const val = prompt('Digite o valor real do odômetro da sua moto (KM):', state.totalKm.toFixed(1));
    if (val !== null) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        setState(prev => ({ ...prev, totalKm: num }));
      }
    }
  };

  const addManualTrip = () => {
    const km = prompt('Distância percorrida (km):');
    if (km) {
      const num = parseFloat(km);
      if (!isNaN(num)) {
        const completedTrip: Trip = {
          id: crypto.randomUUID(),
          startTime: Date.now(),
          endTime: Date.now(),
          distance: num,
          points: [],
          status: 'completed',
        };
        setState(prev => ({
          ...prev,
          totalKm: prev.totalKm + num,
          trips: [completedTrip, ...prev.trips],
        }));
      }
    }
  };

  const resetTripMeter = (meter: 'a' | 'b' | 'c') => {
    setState(prev => ({
      ...prev,
      tripMeters: {
        ...prev.tripMeters!,
        [meter]: 0
      }
    }));
  };

  const updateMonthlyGoal = () => {
    const val = prompt('Defina sua meta de quilometragem mensal (KM):', (state.monthlyGoal || 500).toString());
    if (val !== null) {
      const num = parseFloat(val);
      if (!isNaN(num) && num >= 0) {
        setState(prev => ({ ...prev, monthlyGoal: num }));
      }
    }
  };

  // Calculations
  const averageDuration = React.useMemo(() => {
    const completedTrips = state.trips.filter(t => t.endTime && t.startTime);
    if (completedTrips.length === 0) return 0;
    const totalDuration = completedTrips.reduce((acc, t) => acc + (t.endTime! - t.startTime), 0);
    return Math.round((totalDuration / completedTrips.length) / 60000); // return in minutes
  }, [state.trips]);

  const monthlyKm = React.useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return state.trips
      .filter(t => t.startTime >= startOfMonth)
      .reduce((acc, t) => acc + t.distance, 0);
  }, [state.trips]);

  return (
    <div className="min-h-screen bg-moto-bg flex flex-col font-sans overflow-x-hidden">
      {isAlarmRinging && (
        <motion.div 
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white p-4 sm:p-6 flex flex-col items-center justify-center space-y-3 sm:space-y-4 shadow-2xl"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <Bell className="w-8 h-8 sm:w-12 sm:h-12 animate-bounce" />
            <h2 className="text-xl sm:text-3xl font-black uppercase tracking-tighter">Meta Atingida!</h2>
          </div>
          <button 
            onClick={stopContinuousAlarm}
            className="w-full max-w-md bg-white text-red-600 font-black py-3 sm:py-4 uppercase tracking-widest text-lg sm:text-xl hover:bg-gray-100 active:scale-95 transition-all shadow-xl"
          >
            Desligar Alarme
          </button>
        </motion.div>
      )}
      {/* Top Header / Status Bar */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-moto-border bg-moto-bg/50 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="bg-moto-primary p-1.5 sm:p-2 rounded-sm hidden sm:block">
              <Bike className="w-4 h-4 sm:w-5 h-5 text-black" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <div className={cn(
                  "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-shadow duration-500",
                  trackingError ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : 
                  (activeTrip && activeTrip.points.length > 0) ? "bg-moto-primary shadow-[0_0_8px_var(--color-moto-primary)]" : "bg-yellow-500 shadow-[0_0_8px_#f59e0b]"
                )}></div>
                <button 
                  onClick={() => {
                    // Manual trigger to request permission if it was denied or bugged
                    navigator.geolocation.getCurrentPosition(() => setTrackingError(null));
                  }}
                  className="font-mono text-[9px] sm:text-[11px] tracking-widest uppercase text-moto-muted whitespace-nowrap hover:text-white transition-colors"
                >
                  {trackingError ? `Erro: ${trackingError}` : 
                   (activeTrip && activeTrip.points.length === 0 && activeTrip.status === 'active') ? 'GPS: Localizando...' : 'GPS: Sinal OK'}
                </button>
              </div>
              <h1 className="text-[10px] sm:text-sm font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-white leading-none">Kilometros</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-3 sm:gap-6">
            <button 
              onClick={() => setState(prev => ({ ...prev, muteAlert: !prev.muteAlert }))}
              className={cn(
                "p-1.5 sm:p-2 transition-colors",
                state.muteAlert ? "text-red-500/50" : "text-moto-primary"
              )}
              title={state.muteAlert ? "Ativar Alarme" : "Silenciar Alarme"}
            >
              {state.muteAlert ? <BellOff className="w-4 h-4 sm:w-5 h-5" /> : <Bell className="w-4 h-4 sm:w-5 h-5 animate-bounce-slow" />}
            </button>
            <button 
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-1.5 sm:p-2 text-moto-muted hover:text-moto-primary transition-colors relative"
              title="Mudar Cor"
            >
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-moto-primary animate-pulse"></div>
              {showColorPicker && (
                <div className="absolute top-full right-0 mt-4 p-2 sm:p-3 bg-moto-surface border border-moto-border shadow-2xl flex flex-wrap gap-1.5 sm:gap-2 w-28 sm:w-32 z-[60]">
                  {THEME_COLORS.map(color => (
                    <button
                      key={color.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        setState(prev => ({ ...prev, primaryColor: color.value }));
                        setShowColorPicker(false);
                      }}
                      className={cn(
                        "w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 transition-transform hover:scale-110",
                        state.primaryColor === color.value ? "border-white" : "border-transparent"
                      )}
                      style={{ backgroundColor: color.value }}
                      title={color.name}
                    />
                  ))}
                </div>
              )}
            </button>
             <div className="flex flex-col items-end">
              <span className="text-[9px] sm:text-[11px] text-moto-muted uppercase tracking-tighter leading-none mb-1">Total</span>
              <span className="font-mono text-xs sm:text-base uppercase text-moto-primary font-bold">
                {(state.totalKm + (activeTrip?.distance || 0)).toFixed(1)}
              </span>
            </div>
          <div className="flex flex-col items-end hidden xs:flex">
            <span className="text-[9px] sm:text-[11px] text-moto-muted uppercase tracking-tighter leading-none mb-1">
              {format(Date.now(), 'HH:mm')} 
            </span>
            <span className="font-mono text-xs sm:text-base uppercase">BR</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-8 space-y-3 sm:space-y-0 sm:grid sm:grid-cols-12 sm:gap-1 bg-moto-border">
        {/* Main Interface */}
        <div className="sm:col-span-8 bg-moto-bg p-4 sm:p-12 flex flex-col justify-center relative overflow-hidden min-h-[300px] sm:min-h-[400px]">
          <div className="absolute top-6 left-8 hidden sm:block">
            <h2 className="text-moto-muted text-[10px] sm:text-xs font-bold uppercase tracking-[0.3em]">Odômetro Principal</h2>
          </div>
          
          <div className="flex items-baseline space-x-2 sm:space-x-4">
            <Bike className="w-8 h-8 sm:w-16 sm:h-16 text-moto-primary animate-pulse" />
            <span className="text-6xl sm:text-[180px] font-bold tracking-tighter leading-none mono-display">
              {(state.totalKm + (activeTrip?.distance || 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-lg sm:text-5xl font-light text-moto-muted">KM</span>
            <button 
              onClick={updateOdoManual}
              className="ml-2 sm:ml-4 p-1.5 sm:p-2 text-moto-muted hover:text-moto-primary transition-colors"
            >
              <Wrench className="w-4 h-4 sm:w-8 sm:h-8" />
            </button>
          </div>

          <div className="mt-8 sm:mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-16 border-t border-moto-border pt-8 sm:pt-16">
            <div className="relative group bg-moto-surface/30 p-4 -m-4 sm:bg-transparent sm:p-0 sm:m-0">
              <p className="text-moto-muted text-[10px] sm:text-xs uppercase tracking-widest mb-2 sm:mb-3 font-bold flex items-center gap-2">
                Trip {selectedTripMeter.toUpperCase()}
                <button 
                  onClick={() => setSelectedTripMeter(m => m === 'a' ? 'b' : m === 'b' ? 'c' : 'a')}
                  className="ml-1 p-1 hover:text-moto-primary transition-colors"
                >
                  <RotateCcw className="w-3 h-3 rotate-90" />
                </button>
              </p>
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl sm:text-7xl font-mono font-medium text-white">
                  {(state.tripMeters?.[selectedTripMeter] || 0).toFixed(1)}
                </span>
                <span className="text-sm sm:text-2xl text-moto-muted">KM</span>
              </div>
              
              {!activeTrip ? (
                <div className="mt-6 space-y-4 border-t border-moto-border/30 pt-4">
                  <div className="flex flex-wrap gap-1.5">
                    {[5, 10, 20, 50].map(val => (
                      <button 
                        key={val}
                        onClick={() => setTargetKmInput(val.toString())}
                        className={cn(
                          "px-2 py-1 text-[10px] font-mono border transition-all uppercase",
                          targetKmInput === val.toString() 
                            ? "bg-moto-primary text-black border-moto-primary font-bold" 
                            : "border-moto-border text-moto-muted"
                        )}
                      >
                        {val}k
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number"
                      placeholder="Meta"
                      value={targetKmInput}
                      onChange={(e) => setTargetKmInput(e.target.value)}
                      className="bg-moto-bg border border-moto-border text-xs w-20 px-2 py-2 font-mono focus:outline-none focus:border-moto-primary transition-all text-right"
                    />
                    <button 
                      onClick={startTrip}
                      className="flex-1 bg-moto-primary text-black font-black uppercase tracking-[0.1em] text-[10px] py-2 hover:opacity-90 active:scale-95 transition-all shadow-[0_0_15px_var(--color-moto-primary)] flex items-center justify-center gap-2"
                    >
                      <Play className="w-3 h-3 fill-black" />
                      <span>Iniciar</span>
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => {
                    if (confirm(`Resetar Trip ${selectedTripMeter.toUpperCase()}?`)) {
                      resetTripMeter(selectedTripMeter);
                    }
                  }}
                  className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] uppercase font-bold text-red-500/50 hover:text-red-500 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>

            {activeTrip?.targetDistance && (
              <div className="relative group">
                <p className="text-moto-primary text-[10px] sm:text-xs uppercase tracking-widest mb-2 sm:mb-3 font-bold flex items-center gap-2">
                  <Navigation className="w-3 h-3 sm:w-4 sm:h-4" />
                  Meta Ativa
                </p>
                <div className="flex items-baseline space-x-2">
                  <span className="text-4xl sm:text-7xl font-mono font-bold text-white">
                    {((activeTrip.distance / activeTrip.targetDistance) * 100).toFixed(0)}
                  </span>
                  <span className="text-sm sm:text-2xl text-moto-primary font-bold">%</span>
                </div>
                <div className="mt-2 sm:mt-3 w-full h-1.5 sm:h-2 bg-moto-surface border border-moto-border overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (activeTrip.distance / activeTrip.targetDistance) * 100)}%` }}
                    className={cn(
                      "h-full transition-all duration-500",
                      alertTriggered ? "bg-red-500 shadow-[0_0_15px_#ef4444]" : "bg-moto-primary shadow-[0_0_10px_var(--color-moto-primary)]"
                    )}
                  />
                </div>
                <p className="mt-1 sm:mt-2 text-[10px] sm:text-xs font-mono text-moto-muted font-bold">
                  {activeTrip.distance.toFixed(1)} / {activeTrip.targetDistance} KM
                </p>
                {isAlarmRinging && (
                  <button 
                    onClick={stopContinuousAlarm}
                    className="mt-3 sm:mt-4 w-full bg-red-500 text-white py-2 sm:py-3 font-bold uppercase text-[10px] sm:text-xs tracking-widest animate-pulse"
                  >
                    Parar Alarme
                  </button>
                )}
              </div>
            )}

            <div>
              <p className="text-moto-muted text-[10px] sm:text-xs uppercase tracking-widest mb-2 sm:mb-3 font-bold">Última Viagem</p>
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl sm:text-7xl font-mono font-medium">
                  {formatDistance(state.trips[0]?.distance || 0).split(' ')[0]}
                </span>
                <span className="text-sm sm:text-2xl text-moto-muted">
                  {formatDistance(state.trips[0]?.distance || 0).split(' ')[1] || 'KM'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Side Stats Panel */}
        <aside className="sm:col-span-4 flex flex-col gap-1">
          <div className="bg-moto-surface p-6 sm:p-8 flex flex-col justify-center min-h-[110px] sm:min-h-[140px] relative group">
            <div className="flex justify-between items-start">
              <p className="status-label">Este Mês</p>
              <button 
                onClick={updateMonthlyGoal}
                className="text-moto-muted hover:text-moto-primary transition-colors p-1"
                title="Editar meta mensal"
              >
                <Wrench className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-4xl sm:text-7xl font-bold italic text-white">
                {monthlyKm.toFixed(0)}
              </span>
              <span className="text-sm sm:text-xl font-medium opacity-50">KM</span>
            </div>
            
            {state.monthlyGoal && state.monthlyGoal > 0 ? (
              <div className="mt-2 sm:mt-4">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-[9px] sm:text-xs font-mono text-moto-muted uppercase">Meta: {state.monthlyGoal}</span>
                  <span className="text-[9px] sm:text-xs font-mono font-bold text-moto-primary">
                    {Math.min(100, (monthlyKm / state.monthlyGoal) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-1.5 sm:h-2 bg-moto-border rounded-none overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (monthlyKm / state.monthlyGoal) * 100)}%` }}
                    className={cn(
                      "h-full transition-all duration-1000",
                      monthlyKm >= state.monthlyGoal ? "bg-moto-primary shadow-[0_0_10px_var(--color-moto-primary)]" : "bg-white"
                    )}
                  />
                </div>
              </div>
            ) : (
              <p className="mt-1 sm:mt-2 text-[9px] sm:text-xs text-moto-muted italic">Sem meta</p>
            )}
          </div>
          
          <div className="bg-moto-surface p-6 sm:p-8 flex flex-col justify-center min-h-[110px] sm:min-h-[140px]">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="status-label">Viagens</p>
                <p className="text-2xl sm:text-3xl font-mono font-bold">{state.trips.length}</p>
              </div>
              <div>
                <p className="status-label">Média Dur.</p>
                <p className="text-2xl sm:text-3xl font-mono font-bold">{averageDuration}<span className="text-[10px] sm:text-sm ml-1 font-sans">min</span></p>
              </div>
            </div>
          </div>

          <div className="bg-moto-surface p-6 sm:p-8 flex flex-col justify-center min-h-[110px] sm:min-h-[140px]">
             <p className="status-label">Intervalo Serviço</p>
             <div className="w-full h-1.5 sm:h-2 bg-moto-border rounded-full overflow-hidden mt-2">
                <div 
                  className={cn(
                    "h-full transition-all duration-1000",
                    (state.totalKm - state.lastMaintenanceKm) > 2800 ? "bg-red-500" : "bg-moto-primary"
                  )}
                  style={{ width: `${Math.min(100, ((state.totalKm - state.lastMaintenanceKm) / 3000) * 100)}%` }}
                ></div>
             </div>
             <p className="mt-2 sm:mt-3 text-[10px] sm:text-xs text-right text-moto-muted uppercase tracking-wider font-bold">
               Prox em <span className="text-moto-text font-mono underline decoration-moto-primary text-[10px] sm:text-sm">
                 {Math.max(0, 3000 - (state.totalKm - state.lastMaintenanceKm)).toFixed(0)} KM
               </span>
             </p>
          </div>
        </aside>
      </main>

      {/* Tabs / Sub-views Navigation Container */}
      <section className="max-w-7xl w-full mx-auto px-4 md:px-0 py-8">
        <AnimatePresence mode="wait">
          {view === 'history' && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-4 border-b border-moto-border pb-4">
                <h3 className="font-mono text-sm tracking-[0.3em] uppercase text-moto-muted">Histórico de Viagens</h3>
                <button onClick={addManualTrip} className="text-[10px] uppercase font-bold text-moto-primary border border-moto-primary/30 px-3 py-1 hover:bg-moto-primary hover:text-black">Add Manual</button>
              </div>
              
              {state.trips.length === 0 ? (
                <div className="bg-moto-surface/50 border border-moto-border border-dashed p-12 text-center">
                  <History className="w-8 h-8 text-moto-muted mx-auto mb-4 opacity-20" />
                  <p className="font-mono text-xs text-moto-muted uppercase tracking-widest">Nenhuma viagem registrada</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {state.trips.map(trip => (
                    <div key={trip.id} className="bg-moto-surface border border-moto-border p-6 flex justify-between items-center group">
                      <div>
                        <p className="font-mono text-2xl font-bold leading-none">{trip.distance.toFixed(1)} <span className="text-[10px] font-sans text-moto-primary">KM</span></p>
                        <p className="text-[10px] text-moto-muted mt-2 font-medium tracking-widest">{format(trip.startTime, 'MMM dd, yyyy · HH:mm')}</p>
                      </div>
                      <button onClick={() => deleteTrip(trip.id)} className="text-moto-muted hover:text-red-500 p-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'maintenance' && (
             <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-4 border-b border-moto-border pb-4">
                <h3 className="font-mono text-sm tracking-[0.3em] uppercase text-moto-muted">Manutenção da Frota</h3>
                <button 
                  onClick={() => {
                    const input = prompt('Tipo de manutenção (ex: Óleo, Pneu, Corrente, Freio):');
                    if (input) {
                      const norm = input.toLowerCase();
                      let type: MaintenanceRecord['type'] = 'general';
                      if (norm.includes('oleo') || norm.includes('óleo')) type = 'oil';
                      else if (norm.includes('pneu')) type = 'tires';
                      else if (norm.includes('corrente')) type = 'chain';
                      else if (norm.includes('freio')) type = 'brake';
                      addMaintenance(type, input);
                    }
                  }}
                  className="text-[10px] uppercase font-bold text-moto-primary border border-moto-primary/30 px-3 py-1 hover:bg-moto-primary hover:text-black"
                >Registrar Serviço</button>
              </div>

              {state.maintenance.length === 0 ? (
                <div className="bg-moto-surface/50 border border-moto-border border-dashed p-12 text-center">
                  <Wrench className="w-8 h-8 text-moto-muted mx-auto mb-4 opacity-20" />
                  <p className="font-mono text-xs text-moto-muted uppercase tracking-widest">Nenhuma manutenção registrada</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {state.maintenance.map(record => (
                    <div key={record.id} className="bg-moto-surface border border-moto-border p-6 flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Wrench className="w-3 h-3 text-moto-primary" />
                          <p className="font-mono text-sm uppercase tracking-widest font-bold">
                            {record.notes || record.type}
                          </p>
                        </div>
                        <p className="text-[10px] text-moto-muted font-medium tracking-widest">{format(record.date, 'MMM dd, yyyy')}</p>
                      </div>
                      <p className="font-mono text-xl">{record.kilometers.toFixed(0)} <span className="text-[10px] font-sans text-moto-muted">KM</span></p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Global Footer Controls */}
      <footer className="h-auto min-h-[100px] sm:h-32 bg-moto-bg border-t border-moto-border flex flex-col sm:flex-row items-center justify-between px-3 sm:px-10 fixed bottom-0 left-0 right-0 z-50 py-3 sm:py-0 transition-all">
        <div className="flex items-center gap-2 sm:gap-8 w-full sm:w-auto justify-between sm:justify-start mb-3 sm:mb-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={() => setView(view === 'history' ? 'dashboard' : 'history')}
              className={cn(
                "px-3 sm:px-8 py-2.5 sm:py-3 border text-[9px] sm:text-[13px] uppercase tracking-[0.15em] sm:tracking-[0.2em] transition-all font-bold",
                view === 'history' ? "bg-white text-black border-white" : "border-moto-border text-moto-muted hover:bg-white hover:text-black"
              )}
            >
              Histórico
            </button>
            <button 
              onClick={() => setView(view === 'maintenance' ? 'dashboard' : 'maintenance')}
              className={cn(
                "px-3 sm:px-8 py-2.5 sm:py-3 border text-[9px] sm:text-[13px] uppercase tracking-[0.15em] sm:tracking-[0.2em] transition-all font-bold",
                view === 'maintenance' ? "bg-white text-black border-white" : "border-moto-border text-moto-muted hover:bg-white hover:text-black"
              )}
            >
              Oficina
            </button>
          </div>
          <button 
             onClick={resetOdo}
             className="p-2 sm:p-3 text-moto-muted hover:text-red-500 scale-110 sm:scale-125"
          >
            <RotateCcw className="w-4 h-4 sm:w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-3 sm:space-x-12 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex flex-col items-end hidden lg:flex">
            <span className="text-[11px] uppercase text-moto-muted tracking-widest font-bold">Status</span>
            <span className="font-mono text-sm font-bold tracking-tight">{activeTrip ? 'RASTREAMENTO ATIVO' : 'SISTEMA PRONTO'}</span>
          </div>
          
          {activeTrip && (
            <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex flex-col items-end">
                <span className="text-[9px] sm:text-xs uppercase text-moto-primary tracking-widest font-bold">Progresso</span>
                <div className="flex items-baseline gap-1.5 sm:gap-2">
                  <span className={cn(
                    "font-mono text-lg sm:text-2xl font-black",
                    alertTriggered ? "text-red-500 animate-pulse" : "text-white"
                  )}>
                    {activeTrip.targetDistance ? ((activeTrip.distance / activeTrip.targetDistance) * 100).toFixed(0) : '—'}%
                  </span>
                  {activeTrip.targetDistance && (
                    <span className="text-[10px] sm:text-sm text-moto-muted font-mono whitespace-nowrap">/ {activeTrip.targetDistance}k</span>
                  )}
                </div>
              </div>
              <button 
                onClick={stopTrip}
                className="h-10 sm:h-16 px-6 sm:px-16 bg-red-500 text-white font-black uppercase tracking-[0.1em] sm:tracking-[0.2em] text-[10px] sm:text-base hover:opacity-90 active:scale-95 transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] flex items-center gap-2 sm:gap-3"
              >
                <Square className="w-4 h-4 sm:w-5 h-5 fill-white" />
                <span>Parar</span>
              </button>
            </div>
          )}
        </div>
      </footer>
      
      {/* Spacer for fixed footer */}
      <div className="h-32 sm:h-32"></div>
    </div>
  );
}

function TripCard({ trip, onDelete }: { trip: Trip; onDelete: (id: string) => void }) {
  return (
    <div className="dashboard-card py-4 group">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-black/40 rounded-xl">
            <MapPin className="w-5 h-5 text-moto-primary" />
          </div>
          <div>
            <p className="font-display font-black text-xl italic leading-none mb-1">
              {trip.distance.toFixed(1)} <span className="text-xs font-bold text-moto-primary not-italic">KM</span>
            </p>
            <p className="text-[10px] uppercase font-mono text-white/40 tracking-widest">
              {format(trip.startTime, 'dd MMM - HH:mm')}
            </p>
          </div>
        </div>
        <button 
          onClick={() => onDelete(trip.id)}
          className="opacity-0 group-hover:opacity-100 p-2 text-white/20 hover:text-red-500 transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-display font-black uppercase text-xs tracking-tight",
        active ? "bg-moto-primary text-black" : "text-white/40 hover:text-white/80"
      )}
    >
      {React.cloneElement(icon as React.ReactElement, { className: "w-5 h-5" })}
      {active && <span>{label}</span>}
    </button>
  );
}

