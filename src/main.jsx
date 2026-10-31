import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock3, GripVertical, Plus, Trash2, ChevronUp, ChevronDown, Save, FolderOpen, RotateCcw, Printer, ChefHat, X, Check, TimerReset } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import "./index.css";

const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const DEFAULT_STEPS = [
  { id: "1", duration: 15, text: "Prepare vegetables and herbs", category: "Prep", allowInterleaving: false, useWaitingTime: false },
  { id: "2", duration: 20, text: "Make the sauce", category: "Prep", allowInterleaving: false, useWaitingTime: false },
  { id: "3", duration: 60, text: "Prove bread", category: "Rest", allowInterleaving: true, useWaitingTime: false, endText: "Take proving bread out" },
  { id: "4", duration: 15, text: "Prepare garnish", category: "Prep", allowInterleaving: false, useWaitingTime: true },
  { id: "5", duration: 10, text: "Prepare and season the chicken", category: "Prep", allowInterleaving: false, useWaitingTime: false },
  { id: "6", duration: 30, text: "Cook the chicken", category: "Cook", allowInterleaving: false, useWaitingTime: false },
  { id: "7", duration: 10, text: "Finish sauce and bread", category: "Finish", allowInterleaving: false, useWaitingTime: false },
  { id: "8", duration: 5, text: "Plate and garnish", category: "Plate", allowInterleaving: false, useWaitingTime: false },
];

const STORAGE_KEY = "menu-planner-v4";
const pad = n => String(n).padStart(2, "0");
const toMin = time => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const toTime = mins => { const total = ((Math.round(Number(mins)) % 1440) + 1440) % 1440; const h = Math.floor(total / 60); const m = total % 60; return `${pad(h)}:${pad(m)}`; };
const fmtDuration = mins => mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function calculateSchedule(steps, planningMode, serviceTime, startTime) {
  if (!steps.length) return [];
  const result = steps.map(step => ({
    ...step,
    endText: step.endText ?? "Finish " + (step.text || "this process"),
    start: null,
    finish: null,
    gapUsed: false,
    gapWarning: false,
  }));
  const parallel = result.filter(s => s.useWaitingTime);
  const fixed = result.filter(s => !s.useWaitingTime);

  if (planningMode === "forwards") {
    let cursor = toMin(startTime);
    const windows = [];
    fixed.forEach(step => {
      const start = cursor;
      const finish = start + Number(step.duration || 0);
      step.start = toTime(start);
      step.finish = toTime(finish);
      if (step.allowInterleaving) windows.push({ start, finish, used: [] });
      cursor = finish;
    });
    parallel.forEach(step => {
      const duration = Number(step.duration || 0);
      const window = windows.find(w => w.used.reduce((n, x) => n + x.duration, 0) + duration <= w.finish - w.start);
      if (window) {
        const used = window.used.reduce((n, x) => n + x.duration, 0);
        step.start = toTime(window.start + used);
        step.finish = toTime(window.start + used + duration);
        step.gapUsed = true;
        window.used.push({ step, duration });
      } else {
        const start = cursor;
        const finish = start + duration;
        step.start = toTime(start);
        step.finish = toTime(finish);
        step.gapWarning = true;
        cursor = finish;
      }
    });
  } else {
    let cursor = toMin(serviceTime);
    const windows = [];
    [...fixed].reverse().forEach(step => {
      const finish = cursor;
      const start = finish - Number(step.duration || 0);
      step.start = toTime(start);
      step.finish = toTime(finish);
      if (step.allowInterleaving) windows.push({ start, finish, used: [] });
      cursor = start;
    });
    parallel.slice().reverse().forEach(step => {
      const duration = Number(step.duration || 0);
      const window = windows.find(w => w.used.reduce((n, x) => n + x.duration, 0) + duration <= w.finish - w.start);
      if (window) {
        const used = window.used.reduce((n, x) => n + x.duration, 0);
        const finish = window.finish - used;
        const start = finish - duration;
        step.start = toTime(start);
        step.finish = toTime(finish);
        step.gapUsed = true;
        window.used.push({ step, duration });
      } else {
        const finish = cursor;
        const start = finish - duration;
        step.start = toTime(start);
        step.finish = toTime(finish);
        step.gapWarning = true;
        cursor = start;
      }
    });
  }

  // Waiting/resting stages create an automatic zero-duration completion task at
  // their end time. The completion text is stored on the parent stage so it can
  // be edited without becoming a separate schedulable task.
  const endTasks = result
    .filter(step => step.allowInterleaving && step.start && step.finish)
    .map(step => ({
      id: `end-${step.id}`,
      parentId: step.id,
      isAutoEnd: true,
      duration: 0,
      text: step.endText,
      category: "Finish",
      start: step.finish,
      finish: step.finish,
      gapUsed: false,
      gapWarning: false,
      allowInterleaving: false,
      useWaitingTime: false,
    }));

  const scheduled = [...result, ...endTasks];
  scheduled.sort((a, b) => {
    const diff = toMin(a.start) - toMin(b.start);
    if (diff !== 0) return diff;
    // Put the automatic end action after other work at the same minute.
    if (a.isAutoEnd !== b.isAutoEnd) return a.isAutoEnd ? 1 : -1;
    return 0;
  });
  return scheduled;
}
function App() {
  const [menuName, setMenuName] = useState("My Menu");
  const [serviceTime, setServiceTime] = useState("19:00");
  const [startTime, setStartTime] = useState("14:00");
  const [planningMode, setPlanningMode] = useState("backwards");
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [menus, setMenus] = useState([]);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [showMenus, setShowMenus] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (data) {
        setMenuName(data.menuName || "My Menu"); setServiceTime(data.serviceTime || "19:00"); setStartTime(data.startTime || "14:00");
        setPlanningMode(data.planningMode || "backwards"); setSteps(data.steps?.length ? data.steps.map(s => ({ allowInterleaving: false, useWaitingTime: false, endText: s.allowInterleaving ? `Finish ${s.text || "this process"}` : "", ...s })) : DEFAULT_STEPS); setMenus(data.menus || []);
      }
    } catch { /* ignore corrupt local data */ }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) { setSession(nextSession); if (!nextSession) setCloudStatus(""); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("menus").select("id, menu_name, menu_data, updated_at").order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) { setCloudStatus(`Cloud menus unavailable: ${error.message}`); return; }
      setMenus(data.map(row => ({ ...row.menu_data, id: row.id, menuName: row.menu_name, updatedAt: row.updated_at, cloud: true })));
      setCloudStatus("Menus synced to your account.");
    })();
    return () => { cancelled = true; };
  }, [session]);

  const schedule = useMemo(() => calculateSchedule(steps, planningMode, serviceTime, startTime), [steps, planningMode, serviceTime, startTime]);
  const totalMinutes = useMemo(() => steps.reduce((sum, s) => sum + Number(s.duration || 0), 0), [steps]);
  const activeMinutes = useMemo(() => schedule.filter(s => !s.gapUsed).reduce((sum, s) => sum + Number(s.duration || 0), 0), [schedule]);
  const gapMinutes = Math.max(0, totalMinutes - activeMinutes);
  const firstStart = schedule.filter(s => s.start).reduce((earliest, s) => earliest == null ? toMin(s.start) : Math.min(earliest, toMin(s.start)), null);
  const finalFinish = planningMode === "backwards" ? serviceTime : toTime(schedule.length ? schedule.reduce((latest, s) => Math.max(latest, toMin(s.finish)), 0) : toMin(startTime));

  const update = (id, patch) => setSteps(items => items.map(s => s.id === id ? { ...s, ...patch } : s));
  const add = (useWaitingTime = false) => setSteps(items => [...items, { id: uid(), duration: 10, text: "New cooking step", category: "Prep", allowInterleaving: false, useWaitingTime, endText: "Finish this process" }]);
  const remove = id => setSteps(items => items.filter(s => s.id !== id));
  const move = (id, dir) => setSteps(items => { const i = items.findIndex(s => s.id === id), j = i + dir; if (j < 0 || j >= items.length) return items; const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const drop = targetId => { if (!dragId || dragId === targetId) return; setSteps(items => { const from = items.findIndex(s => s.id === dragId), to = items.findIndex(s => s.id === targetId); const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); setDragId(null); };

  const saveMenu = async () => {
    const menu = { id: uid(), menuName, serviceTime, startTime, planningMode, steps, updatedAt: new Date().toISOString() };
    const next = [menu, ...menus.filter(m => m.menuName !== menuName)].slice(0, 12);
    setMenus(next); localStorage.setItem(STORAGE_KEY, JSON.stringify({ menuName, serviceTime, startTime, planningMode, steps, menus: next }));
    if (supabase && session?.user) {
      const { error } = await supabase.from("menus").upsert({ user_id: session.user.id, menu_name: menuName, menu_data: { serviceTime, startTime, planningMode, steps }, updated_at: menu.updatedAt }, { onConflict: "user_id,menu_name" });
      if (error) setCloudStatus(`Saved locally; cloud save failed: ${error.message}`);
      else { setCloudStatus("Menu saved to your account."); const { data } = await supabase.from("menus").select("id, menu_name, menu_data, updated_at").order("updated_at", { ascending: false }); if (data) setMenus(data.map(row => ({ ...row.menu_data, id: row.id, menuName: row.menu_name, updatedAt: row.updated_at, cloud: true }))); }
    }
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };
  const deleteMenu = async menu => {
    setMenus(current => current.filter(item => item.id !== menu.id));
    if (menu.cloud && supabase && session?.user) { const { error } = await supabase.from("menus").delete().eq("id", menu.id); if (error) setCloudStatus(`Delete failed: ${error.message}`); }
  };
  const signIn = async () => {
    if (!supabase) { setCloudStatus("Add the Supabase URL and anon key to enable cloud menus."); return; }
    setAuthBusy(true); setCloudStatus("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setCloudStatus(error ? error.message : "Check your email for the sign-in link."); setAuthBusy(false);
  };
  const signOut = async () => { await supabase?.auth.signOut(); setCloudStatus("Signed out. Local menus remain available."); };
  const loadMenu = menu => { setMenuName(menu.menuName); setServiceTime(menu.serviceTime); setStartTime(menu.startTime || "14:00"); setPlanningMode(menu.planningMode || "backwards"); setSteps((menu.steps || []).map(s => ({ allowInterleaving: false, useWaitingTime: false, endText: s.allowInterleaving ? `Finish ${s.text || "this process"}` : "", ...s }))); setShowMenus(false); };
  const newMenu = () => { setMenuName("New Menu"); setServiceTime("19:00"); setStartTime("14:00"); setPlanningMode("backwards"); setSteps([]); };
  const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ menuName, serviceTime, startTime, planningMode, steps, menus }));
  useEffect(() => { persist(); }, [menuName, serviceTime, startTime, planningMode, steps, menus]);

  return <div className="min-h-screen bg-zinc-50 text-zinc-900">
    <header className="border-b border-zinc-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:flex-nowrap sm:px-5">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-zinc-900 p-2 text-white"><ChefHat size={21}/></div><div><h1 className="text-xl font-bold tracking-tight">Menu Planner</h1><p className="text-xs text-zinc-500">Kitchen timeline & service planner</p></div></div>
        <div className="flex w-full gap-2 sm:w-auto"><button onClick={newMenu} className="btn-secondary flex-1 sm:flex-none">New</button><button onClick={() => setShowMenus(true)} className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 sm:flex-none"><FolderOpen size={16}/> Menus</button><button onClick={saveMenu} className="btn-primary inline-flex flex-1 items-center justify-center gap-2 sm:flex-none">{saved ? <Check size={16}/> : <Save size={16}/>} {saved ? "Saved" : "Save"}</button></div>
      </div>
    </header>

    <main className="mx-auto max-w-7xl min-w-0 px-4 py-5 sm:px-5 sm:py-6">
      {supabase && <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden"><div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><span className="label">Cloud menu account</span>{session ? <p className="text-sm text-zinc-700">Signed in as {session.user.email}</p> : <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="field" placeholder="you@example.com"/>}</div>{session ? <button onClick={signOut} className="btn-secondary">Sign out</button> : <button onClick={signIn} disabled={authBusy || !email} className="btn-secondary">{authBusy ? "Sending…" : "Email me a sign-in link"}</button>}</div>{cloudStatus && <p className="mt-2 text-xs text-zinc-600" role="status">{cloudStatus}</p>}</section>}
      <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl shadow-black/10">
        <div className="grid gap-5 md:grid-cols-[1fr_180px_180px]">
          <label className="block"><span className="label">Menu / dish name</span><input value={menuName} onChange={e=>setMenuName(e.target.value)} className="field text-lg font-semibold" placeholder="e.g. Chicken curry service"/></label>
          <label className="block"><span className="label">Service time</span><input type="time" value={serviceTime} onChange={e=>setServiceTime(e.target.value)} className="field"/></label>
          <label className="block"><span className="label">Planning mode</span><select value={planningMode} onChange={e=>setPlanningMode(e.target.value)} className="field"><option value="backwards">Work backwards</option><option value="forwards">Work forwards</option></select></label>
        </div>
        {planningMode === "forwards" && <div className="mt-4 max-w-[180px]"><label className="block"><span className="label">Start time</span><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="field"/></label></div>}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-500"><b className="text-zinc-700">{planningMode === "backwards" ? `Service at ${serviceTime}` : `Starting at ${startTime}`}</b><span>·</span><span>{steps.length} steps</span><span>·</span><span>{fmtDuration(activeMinutes)} active</span>{gapMinutes > 0 && <><span>·</span><span className="text-emerald-700">{fmtDuration(gapMinutes)} running during waiting time</span></>}</div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-black/10">
        <div className="hidden grid-cols-[42px_90px_90px_100px_95px_1fr_240px_54px] gap-2 border-b border-zinc-200 bg-zinc-100 px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-zinc-500 md:grid"><div></div><div>Start</div><div>Finish</div><div>Duration</div><div>Type</div><div>Process / description</div><div>Timing</div><div></div></div>
        {schedule.map((s,i)=> s.isAutoEnd ? <div key={s.id} className="process-row grid gap-2 border-b border-zinc-200 bg-amber-50 px-3 py-3 md:grid-cols-[42px_90px_90px_100px_95px_1fr_240px_54px] md:items-center">
          <div className="flex items-center gap-1 text-amber-700"><TimerReset size={16}/><span className="text-xs">↳</span></div>
          <div><span className="mobile-label">Start</span><div className="time-pill">{s.start}</div></div>
          <div><span className="mobile-label">Finish</span><div className="time-pill">{s.finish}</div></div>
          <div><span className="mobile-label">Duration</span><div className="time-pill text-zinc-500">End task</div></div>
          <div><span className="mobile-label">Type</span><div className="time-pill">Finish</div></div>
          <div><span className="mobile-label">Process / description</span><textarea value={s.text} rows="2" onChange={e=>update(s.parentId,{endText:e.target.value})} className="field resize-none"/></div>
          <div><span className="mobile-label">Timing</span><div className="rounded-md border border-amber-200 bg-amber-100 px-2.5 py-2 text-xs text-amber-800">Automatically added at the end of the waiting stage.</div></div>
          <div></div>
        </div> : <div key={s.id} draggable onDragStart={()=>setDragId(s.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>drop(s.id)} className={`process-row grid gap-2 border-b border-zinc-200 px-3 py-3 last:border-0 hover:bg-zinc-50 md:grid-cols-[42px_90px_90px_100px_95px_1fr_240px_54px] md:items-center ${s.gapUsed ? "bg-emerald-50" : ""}`}>
          <div className="flex items-center gap-1 text-zinc-500"><GripVertical size={18} className="cursor-grab"/><span className="text-xs">{i+1}</span></div>
          <div><span className="mobile-label">Start</span><div className="time-pill">{s.start || "—"}</div></div>
          <div><span className="mobile-label">Finish</span><div className="time-pill">{s.finish || "—"}</div></div>
          <div><span className="mobile-label">Duration</span><div className="flex items-center gap-1"><input type="number" min="1" value={s.duration} onChange={e=>update(s.id,{duration:Math.max(1,Number(e.target.value)||1)})} className="field w-20"/><span className="text-xs text-zinc-500">min</span></div></div>
          <div><span className="mobile-label">Type</span><select value={s.category} onChange={e=>update(s.id,{category:e.target.value})} className="field"><option>Prep</option><option>Cook</option><option>Rest</option><option>Finish</option><option>Plate</option><option>Clean</option></select></div>
          <div><span className="mobile-label">Process / description</span><textarea value={s.text} rows="2" onChange={e=>update(s.id,{text:e.target.value})} className="field resize-none"/></div>
          <div className="space-y-2"><label className="check-row"><input type="checkbox" checked={s.allowInterleaving} onChange={e=>update(s.id,{allowInterleaving:e.target.checked})}/><span><b>Allow other steps during this time</b><small>Use this for proving, resting, marinating or slow cooking.</small></span></label>{s.allowInterleaving && <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-500">End action</span><input value={s.endText || ""} onChange={e=>update(s.id,{endText:e.target.value})} className="field" placeholder="e.g. Take proving bread out"/></label>}<label className="check-row"><input type="checkbox" checked={s.useWaitingTime} onChange={e=>update(s.id,{useWaitingTime:e.target.checked})}/><span><b>Use available waiting time</b><small>{s.gapUsed ? "Scheduled inside a waiting window." : s.gapWarning ? "No suitable waiting time, so it extends the plan." : "Fit this task into a waiting window where possible."}</small></span></label>{s.gapUsed && <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700"><TimerReset size={13}/> In waiting time</div>}{s.gapWarning && <div className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800">Not enough waiting time</div>}</div>
          <div className="flex items-center justify-end gap-0.5 md:flex-col"><button disabled={steps.findIndex(x=>x.id===s.id)===0} onClick={()=>move(s.id,-1)} className="icon-btn" title="Move up"><ChevronUp size={16}/></button><button disabled={steps.findIndex(x=>x.id===s.id)===steps.length-1} onClick={()=>move(s.id,1)} className="icon-btn" title="Move down"><ChevronDown size={16}/></button><button onClick={()=>remove(s.id)} className="icon-btn hover:text-red-600" title="Delete"><Trash2 size={15}/></button></div>
        </div>)}
        {!steps.length && <div className="p-12 text-center text-sm text-zinc-500">No steps yet. Add your first cooking process below.</div>}
        <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-zinc-50 p-3"><button onClick={()=>add(false)} className="btn-secondary inline-flex items-center gap-2"><Plus size={16}/> Add cooking step</button><button onClick={()=>add(true)} className="btn-secondary inline-flex items-center gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"><Clock3 size={16}/> Add waiting-time step</button></div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-4"><div className="card"><span className="stat-label">Prep begins</span><strong>{firstStart == null ? "—" : toTime(firstStart)}</strong></div><div className="card"><span className="stat-label">Active work</span><strong>{fmtDuration(activeMinutes)}</strong></div><div className="card"><span className="stat-label">Waiting-time work</span><strong>{fmtDuration(gapMinutes)}</strong></div><div className="card"><span className="stat-label">Service</span><strong>{finalFinish}</strong></div></section>

      <section className="mt-5 rounded-2xl border border-zinc-200 bg-white p-5 print:hidden"><div className="flex items-start gap-3"><div className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Clock3 size={18}/></div><div><h2 className="font-semibold text-zinc-900">Using waiting time</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">Mark a stage such as <b className="text-zinc-700">Prove bread</b> as <b className="text-zinc-700">Allow other steps during this time</b>. Then tick <b className="text-zinc-700">Use available waiting time</b> on smaller jobs. The planner places those jobs inside the proving window, keeps the proving end time fixed, and automatically adds an editable end task such as “Take proving bread out” at that exact time.</p></div></div></section>
      <div className="mt-4 flex justify-end print:hidden"><button onClick={()=>window.print()} className="btn-secondary inline-flex items-center gap-2"><Printer size={16}/> Print kitchen sheet</button></div>
    </main>

    {showMenus && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 sm:p-5" onClick={()=>setShowMenus(false)}><div className="mx-auto mt-8 max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:mt-16" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between border-b border-zinc-200 p-4"><h2 className="font-bold">Saved menus</h2><button onClick={()=>setShowMenus(false)} className="text-zinc-500 hover:text-zinc-900"><X size={19}/></button></div><div className="max-h-[70vh] overflow-auto p-3">{menus.length ? menus.map(menu=><div key={menu.id} className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 p-3"><button onClick={()=>loadMenu(menu)} className="min-w-0 flex-1 text-left"><b className="block truncate">{menu.menuName}</b><span className="block text-xs text-zinc-500">Service {menu.serviceTime} · {menu.steps.length} steps{menu.cloud ? " · Cloud" : " · This device"}</span></button><RotateCcw size={16} className="shrink-0 text-zinc-500"/><button onClick={()=>deleteMenu(menu)} aria-label={`Delete ${menu.menuName}`} className="icon-btn shrink-0 hover:text-red-600"><Trash2 size={16}/></button></div>) : <p className="p-6 text-center text-sm text-zinc-500">No saved menus yet.</p>}</div></div></div>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
