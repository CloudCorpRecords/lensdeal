import { useCallback, useMemo, useState } from 'react';
export function useSceneControls(base:Record<string,number>){
  const keys=useMemo(()=>Object.keys(base),[base]);
  const [active,setActive]=useState(0),[locked,setLocked]=useState(false),[paused,setPaused]=useState(false),[mountKey,setMountKey]=useState(0),[tick,setTick]=useState(0);
  const durations=useMemo(()=>{
    const key=keys[active];
    if(locked)return {[`${key}_r1`]:base[key],[`${key}_r2`]:base[key]};
    return Object.fromEntries(keys.map((_,i)=>{const k=keys[(active+i)%keys.length];return[k,base[k]];}));
  },[base,keys,active,locked]);
  const onSceneChange=useCallback((raw:string)=>{setActive(keys.indexOf(raw.replace(/_r[12]$/,'')));setTick(t=>t+1);},[keys]);
  const jumpTo=(i:number)=>{setActive(i);setPaused(false);setMountKey(k=>k+1);setTick(t=>t+1);};
  return {keys,active,locked,paused,mountKey,tick,durations,onSceneChange,jumpTo,togglePause:()=>setPaused(p=>!p),toggleLock:()=>{setLocked(l=>!l);setPaused(false);setMountKey(k=>k+1);}};
}