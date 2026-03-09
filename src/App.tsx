/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Upload, Image as ImageIcon, Wand2, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const GEMINI_MODEL = "gemini-2.5-flash-image";

export default function App() {
  const [playerImage, setPlayerImage] = useState<string | null>(null);
  const [jerseyImage, setJerseyImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSelectedKey, setHasSelectedKey] = useState(false);
  const [tempKey, setTempKey] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setDebugLog(prev => [msg, ...prev].slice(0, 5));
  };

  useEffect(() => {
    // Vérifier si une clé est déjà enregistrée au démarrage
    const savedKey = localStorage.getItem('gemini_api_key_fallback');
    if (savedKey && savedKey.startsWith('AIza')) {
      setIsKeySaved(true);
    } else {
      // Si on est sur le lien externe et qu'il n'y a pas de clé, on affiche les réglages
      const isExternal = !window.location.hostname.includes('preview') && !window.location.hostname.includes('localhost');
      if (isExternal) {
        setShowKeySettings(true);
      }
    }

    let timer: any;
    if (retryCountdown > 0) {
      timer = setInterval(() => {
        setRetryCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [retryCountdown]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasSelectedKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasSelectedKey(true);
      setError(null);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
    });
  };

  const generateSwappedKit = async () => {
    if (isLoading || retryCountdown > 0) return;
    
    if (!playerImage || !jerseyImage) {
      setError("Veuillez fournir une image de joueur et une image de maillot.");
      return;
    }

    setIsLoading(true);
    setError(null);
    addLog("Préparation des images...");

    try {
      const modelToUse = GEMINI_MODEL;
      
      // Accès sécurisé à la clé API (évite le crash sur lien externe)
      const manualKey = localStorage.getItem('gemini_api_key_fallback');
      let envKey = null;
      try {
        envKey = (window as any).process?.env?.API_KEY || (window as any).process?.env?.GEMINI_API_KEY;
      } catch (e) {
        // process.env n'est pas disponible, c'est normal sur le lien externe
      }
      
      let apiKey = manualKey && manualKey.startsWith('AIza') ? manualKey : envKey;
      
      if (!apiKey || apiKey === "undefined" || apiKey === "null") {
        addLog("Erreur : Aucune clé API trouvée. Veuillez configurer votre clé.");
        setError("MISSING_API_KEY");
        setIsLoading(false);
        return;
      }

      addLog("Connexion à l'IA de Google...");
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      
      const getMimeType = (dataUrl: string) => {
        const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        return match ? match[1] : "image/png";
      };

      const playerMime = getMimeType(playerImage);
      const jerseyMime = getMimeType(jerseyImage);
      
      addLog("Compression des images (optimisation)...");
      const playerBase64 = await compressImage(playerImage);
      const jerseyBase64 = await compressImage(jerseyImage);

      addLog("Envoi à Gemini (cela peut prendre 20s)...");
      
      // Timeout manuel avec Promise.race
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT_REACHED")), 45000)
      );

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelToUse,
            contents: {
              parts: [
                { inlineData: { data: playerBase64, mimeType: playerMime } },
                { inlineData: { data: jerseyBase64, mimeType: jerseyMime } },
                { text: "Swap the football jersey: Take the person from the first image and put them in the football jersey from the second image. High quality, realistic football player photo." },
              ],
            },
          }),
          timeoutPromise
        ]) as any;

        addLog("Réponse reçue ! Analyse...");
        
        if (!response.candidates || response.candidates.length === 0) {
          throw new Error("L'IA n'a pas pu générer l'image. Réessayez.");
        }

        const candidate = response.candidates[0];
        
        if (candidate.finishReason === "SAFETY") {
          throw new Error("La génération a été bloquée par les filtres de sécurité. Cela arrive souvent avec des célébrités ou des personnalités publiques (comme Ronaldo ou Messi). Essayez avec une photo de joueur moins connu ou une photo de vous.");
        }

        let foundImage = false;
        let aiTextResponse = "";

        for (const part of candidate.content?.parts || []) {
          if (part.inlineData) {
            setResultImage(`data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`);
            foundImage = true;
            addLog("Image générée avec succès !");
            break;
          } else if (part.text) {
            aiTextResponse += part.text;
          }
        }

        if (!foundImage) {
          throw new Error(aiTextResponse || "Aucune image n'a été générée. L'IA a peut-être du mal avec ces photos spécifiques. Essayez des images plus nettes.");
        }
      } catch (err: any) {
        if (err.message === 'TIMEOUT_REACHED') {
          addLog("Délai dépassé (45s).");
          throw new Error("L'IA met trop de temps à répondre. Réessayez.");
        }
        addLog(`Erreur : ${err.message?.slice(0, 50)}...`);
        throw err;
      }
    } catch (err: any) {
      console.error("Generation error:", err);
      let errorMessage = err.message || "";
      
      // Tentative de lecture du JSON d'erreur de Google
      try {
        if (errorMessage.includes('{')) {
          const jsonErr = JSON.parse(errorMessage.substring(errorMessage.indexOf('{')));
          if (jsonErr.error?.message?.includes('retry in')) {
            const seconds = jsonErr.error.message.match(/retry in ([\d.]+)s/);
            if (seconds) {
              const waitTime = Math.ceil(parseFloat(seconds[1]));
              setError(`Quota atteint. Google demande d'attendre ${waitTime}s.`);
              setRetryCountdown(waitTime);
              addLog(`Quota atteint. Pause de ${waitTime}s...`);
              setIsLoading(false);
              return;
            }
          }
        }
      } catch (e) { /* ignore parse error */ }

      if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("quota")) {
        setError("Quota dépassé. Trop de demandes en une minute.");
        setRetryCountdown(60);
        addLog("Erreur : Trop de demandes (Quota).");
      } else if (errorMessage.includes("403") || errorMessage.includes("permission")) {
        setError("Clé API invalide ou inactive.");
        setIsKeySaved(false);
        setShowKeySettings(true);
        addLog("Erreur : Clé API refusée.");
      } else if (errorMessage.includes("SAFETY")) {
        setError("Bloqué par la sécurité (évitez les célébrités).");
        addLog("Erreur : Filtre de sécurité.");
      } else {
        setError("Erreur de connexion. Réessayez dans un instant.");
        addLog("Erreur de connexion.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Top Navigation / Settings */}
      <div className="fixed top-6 right-6 z-50">
        <button 
          onClick={() => setShowKeySettings(!showKeySettings)}
          className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 text-xs font-bold ${
            showKeySettings 
              ? 'bg-blue-500 border-blue-400 text-white' 
              : 'bg-black/40 border-white/10 text-zinc-400 hover:border-white/30'
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${showKeySettings ? 'animate-spin' : ''}`} />
          {isKeySaved ? '🔑 Modifier la Clé' : '🔑 Configurer la Clé'}
        </button>
      </div>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        <header className="mb-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              FOOT KIT SWAPPER
            </h1>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
              Transformez n'importe quel joueur avec le maillot de votre choix grâce à l'IA.
            </p>
          </motion.div>
        </header>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Controls Section */}
          <section className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              {/* Player Upload */}
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Image du Joueur</label>
                <div className="relative aspect-[3/4] rounded-2xl border border-white/10 bg-white/5 overflow-hidden group">
                  {playerImage ? (
                    <img src={playerImage} alt="Player" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <ImageIcon className="w-8 h-8 text-zinc-600 mb-2" />
                      <span className="text-xs text-zinc-500">Charger Joueur</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, setPlayerImage)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <Upload className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Jersey Upload */}
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Image du Maillot</label>
                <div className="relative aspect-[3/4] rounded-2xl border border-white/10 bg-white/5 overflow-hidden group">
                  {jerseyImage ? (
                    <img src={jerseyImage} alt="Jersey" className="w-full h-full object-contain p-4" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <ImageIcon className="w-8 h-8 text-zinc-600 mb-2" />
                      <span className="text-xs text-zinc-500">Charger Maillot</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, setJerseyImage)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <Upload className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="space-y-2">
              <button
                onClick={generateSwappedKit}
                disabled={isLoading || !playerImage || !jerseyImage || retryCountdown > 0}
                className="w-full py-4 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    GÉNÉRATION EN COURS...
                  </>
                ) : retryCountdown > 0 ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    RÉESSAYER DANS {retryCountdown}S
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    GÉNÉRER LE SWAP
                  </>
                )}
              </button>
              
              {isLoading && (
                <button 
                  onClick={() => {
                    setIsLoading(false);
                    addLog("Génération annulée par l'utilisateur.");
                  }}
                  className="w-full py-2 text-[10px] text-zinc-500 hover:text-red-400 transition-colors uppercase tracking-widest font-bold"
                >
                  Annuler la génération
                </button>
              )}
            </div>

            {(error === "MISSING_API_KEY" || !isKeySaved || showKeySettings) && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 rounded-3xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-500/30 shadow-2xl backdrop-blur-xl space-y-6"
              >
                <div className="space-y-2 text-center">
                  <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <RefreshCw className="w-8 h-8 text-blue-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Configuration Requise</h3>
                  <p className="text-zinc-400 text-sm">
                    Pour utiliser ce lien partagé, vous devez activer l'application avec votre propre clé API Google Gemini (Gratuit).
                  </p>
                </div>

                <div className="bg-black/40 rounded-2xl p-4 border border-white/5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Étape 1 : Obtenir une clé</label>
                    <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      className="flex items-center justify-between p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors group"
                    >
                      <span className="text-sm font-medium text-blue-400">Créer ma clé gratuite</span>
                      <Wand2 className="w-4 h-4 text-blue-400 group-hover:translate-x-1 transition-transform" />
                    </a>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Étape 2 : Activer</label>
                    <div className="flex gap-2">
                      <input 
                        type="password"
                        placeholder="Collez votre clé AIza..."
                        className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                        value={tempKey}
                        onChange={(e) => setTempKey(e.target.value)}
                      />
                      <button 
                        onClick={() => {
                          const key = tempKey.trim();
                          if (key.startsWith('AIza')) {
                            localStorage.setItem('gemini_api_key_fallback', key);
                            setIsKeySaved(true);
                            setShowKeySettings(false);
                            setError(null);
                            addLog("Application activée avec succès !");
                          } else {
                            setError("La clé doit commencer par 'AIza'");
                          }
                        }}
                        className="px-6 py-3 bg-blue-500 rounded-xl text-sm font-bold hover:bg-blue-400 transition-all active:scale-95"
                      >
                        ACTIVER
                      </button>
                    </div>
                  </div>
                </div>

                {isKeySaved && (
                  <button 
                    onClick={() => setShowKeySettings(false)}
                    className="w-full py-3 text-zinc-500 text-xs hover:text-white transition-colors"
                  >
                    Continuer avec la clé actuelle
                  </button>
                )}
              </motion.div>
            )}

            {/* Debug Log */}
            {debugLog.length > 0 && (
              <div className="p-4 rounded-xl bg-black/20 border border-white/5 font-mono text-[10px] text-zinc-500 space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="uppercase tracking-widest font-bold text-zinc-600">Journal d'activité :</p>
                  <button 
                    onClick={() => {
                      setDebugLog([]);
                      setPlayerImage(null);
                      setJerseyImage(null);
                      setResultImage(null);
                      setError(null);
                      setIsLoading(false);
                      setRetryCountdown(0);
                    }}
                    className="text-[9px] hover:text-white underline"
                  >
                    Réinitialiser Tout
                  </button>
                </div>
                {debugLog.map((log, i) => (
                  <p key={i} className={i === 0 ? "text-emerald-500/80" : ""}>
                    {i === 0 ? "> " : "  "}{log}
                  </p>
                ))}
              </div>
            )}

            {error && error !== "MISSING_API_KEY" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 rounded-xl bg-red-400/10 border border-red-400/20 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-red-400 text-sm font-medium">
                    {error}
                  </p>
                  <button 
                    onClick={() => setError(null)}
                    className="text-[10px] text-zinc-500 underline"
                  >
                    Effacer
                  </button>
                </div>
                {error.includes("Quota") && (
                  <div className="text-[11px] text-zinc-400 leading-relaxed space-y-2">
                    <p>
                      <span className="text-amber-400 font-bold">Pourquoi ce message ?</span> Sur ce lien public, vous utilisez votre clé personnelle gratuite. Google limite strictement le nombre d'images générées par minute.
                    </p>
                    <p>
                      <b>Solution :</b> Attendez la fin du décompte, et essayez avec une photo <b>qui n'est pas une star</b> (l'IA bloque souvent les célébrités).
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </section>

          {/* Result Section */}
          <section className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Résultat</label>
            <div className="relative aspect-square rounded-3xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl">
              <AnimatePresence mode="wait">
                {resultImage ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    className="w-full h-full relative"
                  >
                    <img src={resultImage} alt="Generated result" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <button
                      onClick={() => setResultImage(null)}
                      className="absolute top-4 right-4 p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/70 transition-colors"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 p-8 text-center"
                  >
                    {isLoading ? (
                      <div className="space-y-4 flex flex-col items-center">
                        <div className="w-12 h-12 border-4 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
                        <p className="text-sm font-medium animate-pulse text-emerald-500">L'IA crée votre image...</p>
                        <p className="text-[10px] text-zinc-500 italic">Cela prend environ 15-20 secondes</p>
                      </div>
                    ) : error && error !== "MISSING_API_KEY" ? (
                      <div className="space-y-4 flex flex-col items-center text-red-400">
                        <RefreshCw className="w-12 h-12 opacity-50" />
                        <p className="text-sm font-bold">{error}</p>
                        <button 
                          onClick={generateSwappedKit}
                          className="text-xs underline hover:text-red-300"
                        >
                          Réessayer
                        </button>
                      </div>
                    ) : (
                      <>
                        <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-sm max-w-[200px]">Chargez vos images et cliquez sur générer pour voir le résultat.</p>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-white/5 text-center">
        <p className="text-zinc-600 text-xs tracking-widest uppercase">Powered by Gemini 2.5 Flash Image</p>
      </footer>
    </div>
  );
}
