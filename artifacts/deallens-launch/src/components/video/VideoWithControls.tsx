import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import VideoTemplate,{SCENE_DURATIONS} from './VideoTemplate';
import {useSceneControls} from './useSceneControls';
const titles=['Follow the evidence','Research desk','Crusoe copilot','Seller verification','DealLens'];
function Status({active,tick,paused,onJump}:{active:number;tick:number;paused:boolean;onJump:(i:number)=>void}){
  const [elapsed,setElapsed]=useState(0);const base=useRef(0);
  const values=Object.values(SCENE_DURATIONS);
  useEffect(()=>{base.current=0;setElapsed(0);},[tick]);
  useEffect(()=>{if(paused)return;const start=performance.now();const id=setInterval(()=>setElapsed(base.current+performance.now()-start),60);return()=>{clearInterval(id);base.current+=performance.now()-start;};},[tick,paused]);
  const seconds=Math.min(28,Math.floor((values.slice(0,active).reduce((a,b)=>a+b,0)+Math.min(elapsed,values[active]))/1000));
  return <><div className="control-segments">{values.map((v,i)=><button key={i} aria-label={`Jump to scene ${i+1}: ${titles[i]}`} onClick={()=>onJump(i)}><span style={{width:i===active?`${Math.min(100,elapsed/v*100)}%`:'0%'}}/></button>)}</div><small>{active+1}/5</small><small role="timer">0:{String(seconds).padStart(2,'0')} / 0:28</small></>;
}
export default function VideoWithControls(){
  const c=useSceneControls(SCENE_DURATIONS);const [muted,setMuted]=useState(false),[collapsed,setCollapsed]=useState(false),[hover,setHover]=useState(false);
  useEffect(()=>{if(!c.paused)return;const a=document.getAnimations().filter(a=>a.playState==='running');a.forEach(a=>a.pause());return()=>a.forEach(a=>a.play());},[c.paused]);
  if(window.self===window.top)return <VideoTemplate/>;
  return <><VideoTemplate key={c.mountKey} durations={c.durations} paused={c.paused} muted={muted} onSceneChange={c.onSceneChange}/>
    <div className="controls-sensor" onPointerEnter={()=>setHover(true)} onPointerLeave={()=>setHover(false)} onTouchStart={()=>setHover(true)}>
      <div className="film-controls" style={{transform:collapsed&&!hover?'translateY(100%)':'none',opacity:collapsed&&!hover?0:1}}>
        <button aria-label={c.paused?'Play':'Pause'} onClick={c.togglePause}>{c.paused?<Play/>:<Pause/>}</button>
        <button aria-label="Loop current scene" aria-pressed={c.locked} onClick={c.toggleLock}><Repeat/></button>
        <button aria-label={muted?'Unmute':'Mute'} onClick={()=>setMuted(v=>!v)}>{muted?<VolumeX/>:<Volume2/>}</button>
        <Status active={c.active} tick={c.tick} paused={c.paused} onJump={i=>{c.jumpTo(i);window.parent.postMessage({type:'REPLIT_VIDEO_SCENE_SELECTED',payload:{sceneIndex:i,sceneCount:5,sceneTitle:titles[i],filePath:'src/components/video/video_scenes/Scenes.tsx',lineNumber:1}},'*');}}/>
        <button aria-label={collapsed?'Show controls':'Hide controls'} onClick={()=>{setCollapsed(v=>!v);setHover(false);}}>{collapsed?<ChevronUp/>:<ChevronDown/>}</button>
      </div>
    </div></>;
}