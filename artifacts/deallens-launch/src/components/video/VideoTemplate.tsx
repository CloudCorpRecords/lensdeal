/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { VideoCanvas, VideoPausedContext, useVideoPlayer } from '@/lib/video';
import {useEffect,useRef} from 'react';
import { AnimatePresence } from 'framer-motion';
import { Scene1, Scene2, Scene3, Scene4, Scene5 } from './video_scenes/Scenes';
import './film.css';

export const SCENE_DURATIONS = { hook: 4000, desk: 6000, copilot: 6000, verify: 6000, brand: 6000 };
const scenes = [Scene1, Scene2, Scene3, Scene4, Scene5];
const starts=Object.fromEntries(Object.entries(SCENE_DURATIONS).map(([k],i,entries)=>[k,entries.slice(0,i).reduce((a,[,v])=>a+v,0)/1000]));
export default function VideoTemplate({durations=SCENE_DURATIONS,paused=false,muted=false,onSceneChange}:{durations?:Record<string,number>;paused?:boolean;muted?:boolean;onSceneChange?:(key:string)=>void}={}) {
  const { currentSceneKey } = useVideoPlayer({ durations,paused });
  const baseKey=currentSceneKey.replace(/_r[12]$/,'');
  const Scene = scenes[Object.keys(SCENE_DURATIONS).indexOf(baseKey)];
  const audio=useRef<HTMLAudioElement>(null),last=useRef('');
  useEffect(()=>{onSceneChange?.(currentSceneKey);},[currentSceneKey,onSceneChange]);
  useEffect(()=>{const a=audio.current;if(!a)return;a.volume=.45;if(paused){a.pause();return;}if(last.current!==currentSceneKey){last.current=currentSceneKey;const target=starts[baseKey]??0;if(Math.abs(a.currentTime-target)>.18)a.currentTime=target;}a.play().catch(()=>{});},[currentSceneKey,baseKey,paused,muted]);
  return <VideoPausedContext.Provider value={paused}><VideoCanvas aspectRatio="9:16" style={{background:'#24342B'}}>
    <AnimatePresence mode="sync"><Scene key={currentSceneKey}/></AnimatePresence>
    <audio ref={audio} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted}/>
  </VideoCanvas></VideoPausedContext.Provider>;
}