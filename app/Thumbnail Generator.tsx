import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Image as ImageIcon, 
  CreditCard, 
  History, 
  LogOut, 
  Menu, 
  X, 
  ArrowRight, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Github,
  Youtube,
  Twitter
} from 'lucide-react';

// --- Supabase 설정 (제공된 프로젝트 참조) ---
const SUPABASE_URL = "https://vfprnmuccprmzxdtaghr.supabase.co";
const SUPABASE_ANON_KEY = ""; // Supabase Dashboard -> Settings -> API에서 'anon public' 키를 입력하세요.

// --- Gemini API 설정 ---
const apiKey = ""; 
const IMAGEN_MODEL = "imagen-4.0-generate-001";

const App = () => {
  // --- 상태 관리 ---
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [currentImage, setCurrentImage] = useState(null);
  const [error, setError] = useState(null);
  const [showPricing, setShowPricing] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Supabase 클라이언트 참조
  const supabaseRef = useRef(null);

  // --- 라이브러리 로드 및 세션 초기화 ---
  useEffect(() => {
    const loadSupabase = () => {
      return new Promise((resolve, reject) => {
        if (window.supabase) {
          resolve(window.supabase);
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js';
        script.async = true;
        script.onload = () => resolve(window.supabase);
        script.onerror = () => reject(new Error('Supabase SDK를 로드할 수 없습니다.'));
        document.head.appendChild(script);
      });
    };

    const initApp = async () => {
      try {
        const supabaseLib = await loadSupabase();
        // 클라이언트 생성
        supabaseRef.current = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const supabase = supabaseRef.current;

        // 세션 확인
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setUser(session.user);
          await fetchUserData(session.user.id);
          setView('dashboard');
        }

        // 인증 상태 변경 리스너
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (session) {
            setUser(session.user);
            await fetchUserData(session.user.id);
            setView('dashboard');
          } else {
            setUser(null);
            setView('landing');
          }
        });

        setLoading(false);
        return () => authListener.subscription.unsubscribe();
      } catch (err) {
        setError("초기화 중 오류 발생: " + err.message);
        setLoading(false);
      }
    };

    initApp();
  }, []);

  // --- Supabase 데이터 페칭 ---
  const fetchUserData = async (userId) => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    try {
      // 1. 크레딧 정보 가져오기 (profiles 테이블)
      let { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .single();

      if (pError && pError.code === 'PGRST116') {
        // 프로필이 없으면 신규 생성 (기본 10크레딧)
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert([{ id: userId, credits: 10 }])
          .select()
          .single();
        setCredits(newProfile.credits);
      } else {
        setCredits(profile?.credits || 0);
      }

      // 2. 썸네일 이력 가져오기 (thumbnails 테이블)
      const { data: thumbs } = await supabase
        .from('thumbnails')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      setHistory(thumbs || []);
    } catch (err) {
      console.error("데이터 로드 오류:", err);
    }
  };

  // --- AI 이미지 생성 및 DB 저장 ---
  const generateThumbnail = async () => {
    if (!prompt.trim() || !user || !supabaseRef.current) return;
    if (credits <= 0) {
      setShowPricing(true);
      return;
    }

    setIsGenerating(true);
    setError(null);
    const supabase = supabaseRef.current;

    try {
      // 1. AI 이미지 생성 요청 (Imagen 4.0)
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: `High quality YouTube thumbnail, eye-catching, vibrant, ${prompt}` }],
            parameters: { sampleCount: 1 }
          }),
        }
      );

      const result = await response.json();
      
      if (result.predictions?.[0]) {
        const base64Image = result.predictions[0].bytesBase64Encoded;
        const imageUrl = `data:image/png;base64,${base64Image}`;

        // 2. DB 업데이트: 크레딧 차감
        const { error: creditError } = await supabase
          .from('profiles')
          .update({ credits: credits - 1 })
          .eq('id', user.id);

        if (creditError) throw creditError;

        // 3. DB 업데이트: 썸네일 이력 추가
        const { data: newThumb, error: thumbError } = await supabase
          .from('thumbnails')
          .insert([{ 
            user_id: user.id, 
            url: imageUrl, 
            prompt: prompt 
          }])
          .select()
          .single();

        if (thumbError) throw thumbError;

        // 4. 로컬 상태 업데이트
        setCurrentImage(imageUrl);
        setCredits(prev => prev - 1);
        setHistory(prev => [newThumb, ...prev]);
        setPrompt('');
      } else {
        throw new Error("이미지 생성 서버 응답이 올바르지 않습니다.");
      }
    } catch (err) {
      setError("오류가 발생했습니다: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // --- 인증 핸들러 ---
  const handleGoogleLogin = async () => {
    if (!supabaseRef.current) return;
    await supabaseRef.current.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    if (!supabaseRef.current) return;
    await supabaseRef.current.auth.signOut();
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" />
        <p className="text-slate-500 font-medium">서비스를 준비 중입니다...</p>
      </div>
    </div>
  );

  // --- 네비게이션 바 ---
  const Navbar = () => (
    <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-slate-900">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              NailArt AI
            </span>
          </div>
          
          <div className="flex items-center gap-4 md:gap-8">
            {view === 'landing' ? (
              <button onClick={() => setView('auth')} className="bg-indigo-600 text-white px-5 py-2 rounded-full font-medium hover:bg-indigo-700 transition">
                시작하기
              </button>
            ) : (
              <div className="flex items-center gap-4 md:gap-6">
                <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  <CreditCard className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-semibold text-indigo-700">{credits} Credits</span>
                </div>
                <div className="flex items-center gap-3">
                  {user?.user_metadata?.avatar_url && (
                    <img src={user.user_metadata.avatar_url} className="w-8 h-8 rounded-full border hidden sm:block" alt="profile" />
                  )}
                  <button onClick={handleLogout} className="text-gray-500 hover:text-red-500 transition">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );

  // --- 랜딩 페이지 ---
  const LandingPage = () => (
    <div className="pt-24 min-h-screen bg-slate-50 flex flex-col items-center justify-center text-center px-4">
      <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
        <Sparkles className="w-4 h-4" /> <span>유튜브 성장을 위한 AI 파트너</span>
      </div>
      <h1 className="text-5xl md:text-7xl font-extrabold text-gray-900 mb-6 leading-tight">
        클릭을 부르는 <br /><span className="text-indigo-600">AI 유튜브 썸네일</span>
      </h1>
      <p className="text-xl text-gray-600 max-w-2xl mb-10 leading-relaxed">
        복잡한 디자인 툴 없이 텍스트만으로 고퀄리티 썸네일을 생성하세요. <br />
        Supabase로 안전하게 저장하고 관리할 수 있습니다.
      </p>
      <button onClick={() => setView('auth')} className="px-10 py-5 bg-indigo-600 text-white rounded-2xl font-bold text-xl hover:bg-indigo-700 hover:shadow-xl transition transform hover:-translate-y-1">
        지금 무료로 시작하기
      </button>
    </div>
  );

  // --- 대시보드 뷰 ---
  const DashboardView = () => (
    <div className="pt-24 pb-12 min-h-screen bg-slate-50 px-4">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <ImageIcon className="text-indigo-600" /> 썸네일 생성기
            </h2>
            <div className="space-y-4">
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="어떤 유튜브 영상을 만드셨나요? 영상의 주제와 분위기를 입력해주세요..."
                className="w-full h-32 p-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 focus:ring-0 transition text-lg"
              />
              <button 
                onClick={generateThumbnail}
                disabled={isGenerating || !prompt.trim()}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    AI가 그림을 그리는 중...
                  </>
                ) : (
                  <>이미지 생성 (-1 Credit)</>
                )}
              </button>
            </div>
            {error && (
              <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}
          </div>

          {currentImage && (
            <div className="bg-white p-4 rounded-3xl shadow-xl border border-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="relative rounded-2xl overflow-hidden group">
                <img src={currentImage} className="w-full h-auto" alt="result" />
                <div className="absolute top-4 right-4">
                  <button className="p-3 bg-white/90 backdrop-blur rounded-full text-slate-900 shadow-lg hover:scale-110 transition">
                    <Download className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="mt-4 px-2">
                <h4 className="font-bold text-slate-900">방금 생성된 이미지</h4>
                <p className="text-sm text-slate-500 line-clamp-1">{prompt}</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-600" /> 작업 내역 ({history.length})
            </h3>
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {history.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">생성된 내역이 없습니다.</p>
                </div>
              ) : (
                history.map(item => (
                  <div key={item.id} className="group relative rounded-xl overflow-hidden border border-slate-100 hover:shadow-md transition bg-slate-50">
                    <img src={item.url} className="w-full aspect-video object-cover" alt="history" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition p-3 flex flex-col justify-end">
                      <p className="text-white text-[10px] leading-tight line-clamp-2 mb-2">{item.prompt}</p>
                      <span className="text-white/60 text-[8px]">{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="font-sans text-slate-900 bg-slate-50 min-h-screen">
      <Navbar />
      
      {view === 'landing' && <LandingPage />}
      
      {view === 'auth' && (
        <div className="h-screen flex items-center justify-center px-4">
          <div className="bg-white p-8 md:p-12 rounded-[40px] shadow-2xl border border-slate-100 w-full max-w-lg text-center">
            <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Sparkles className="text-white w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold mb-2">시작하기</h2>
            <p className="text-slate-500 mb-10">로그인하여 나만의 AI 썸네일을 관리하세요.</p>
            <button 
              onClick={handleGoogleLogin} 
              className="w-full flex items-center gap-3 justify-center px-8 py-4 bg-white border-2 border-slate-100 rounded-2xl font-bold shadow-sm hover:bg-slate-50 transition transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="google" />
              Google 계정으로 계속하기
            </button>
            <p className="mt-8 text-xs text-slate-400">
              로그인하면 Supabase에 데이터가 영구적으로 저장됩니다.
            </p>
          </div>
        </div>
      )}

      {view === 'dashboard' && <DashboardView />}
      
      {showPricing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 text-center relative shadow-2xl">
            <button onClick={() => setShowPricing(false)} className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition"><X /></button>
            <div className="bg-amber-100 text-amber-700 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-bold mb-2">크레딧이 부족합니다</h3>
            <p className="text-slate-500 mb-8">계속해서 이미지를 생성하려면 크레딧을 충전해주세요.</p>
            <button className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition">크레딧 구매하기</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;