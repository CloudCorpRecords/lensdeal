import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const ease = [0.22,1,0.36,1] as const;
function Reveal({children, delay=0, className=''}:{children:ReactNode;delay?:number;className?:string}) {
  return <motion.div className={className} initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{delay,duration:.65,ease}}>{children}</motion.div>;
}
function Stage({children,mode='',name}:{children:ReactNode;mode?:string;name:string}) {
  return <motion.section data-scene={name} className={`film-scene ${mode}`} initial={{clipPath:'inset(0 0 0 0)',scale:1.08}} animate={{scale:1}} exit={{opacity:0,scale:1.17,rotate:2}} transition={{duration:.65,ease}}>
    <div className="film-top"><span>DealLens</span><span>ACQUISITION RESEARCH</span></div>{children}
  </motion.section>;
}
export function Scene1(){
  return <Stage name="hook"><div className="hook-title"><small>BEFORE YOU BUY</small><Reveal delay={.15}><h1>Follow the<br/><em>evidence.</em></h1></Reveal></div>
    <div className="papers">{['TRAFFIC','SOURCES','SELLER QUESTIONS'].map((word,i)=><motion.div className="paper" key={word} initial={{rotate:0,scale:.8,opacity:0}} animate={{rotate:[0,[-8,6,-3][i],0],scale:[.8,1,1.05],opacity:1,y:[0,0,-i*32]}} transition={{duration:3.2,delay:i*.5,times:[0,.2,1],ease}} style={{top:`${i*12}vmin`,left:`${i%2?9:0}vmin`}}><span>0{i+1} / RESEARCH FILE</span><b>{word}</b><div className="paper-lines"/></motion.div>)}</div>
    <Reveal delay={2} className="film-bottom">Acquisition research.<br/>Not guesswork.</Reveal>
  </Stage>;
}
export function Scene2(){
  return <Stage name="desk" mode="cream"><div className="feature-heading"><small>THE RESEARCH DESK</small><Reveal delay={.2}><h2>A clearer view<br/>of the <em>deal.</em></h2></Reveal></div>
    <motion.div className="dossier" initial={{rotateX:16,rotate:-4,scale:.92}} animate={{rotateX:0,rotate:0,scale:1.03}} transition={{duration:5.8,ease}}>
      <div className="dossier-head">DEALLENS / RESEARCH SET <span>↗</span></div>
      {[
        ['Compare domains','Similarweb traffic estimates'],
        ['Save your research','Source-linked reports'],
        ['Explore the evidence','Companies. Periods. Sources.']
      ].map(([title,desc],i)=><Reveal key={title} delay={.8+i*1.2} className="dossier-row"><span className="row-no">0{i+1}</span><div><h3>{title}</h3><p>{desc}</p></div><motion.b className="citation" initial={{scale:0}} animate={{scale:1}} transition={{delay:1.8+i}}>[{i+1}]</motion.b></Reveal>)}
      <Reveal delay={4.3} className="atlas-label">Evidence Atlas <span>Trace every source.</span></Reveal>
    </motion.div><Reveal delay={4.6} className="film-bottom fine">Estimates ≠ verified business performance</Reveal>
  </Stage>;
}
export function Scene3(){
  return <Stage name="copilot"><div className="feature-heading"><small>CRUSOE-POWERED COPILOT</small><Reveal delay={.2}><h2>Ask a better<br/><em>question.</em></h2></Reveal></div>
    <Reveal delay={.8} className="question"><small>YOUR BUYER QUESTION</small><p>What should I verify<br/>with the seller?</p></Reveal>
    <div className="answer-chain"><motion.div className="chain-line" initial={{scaleY:0}} animate={{scaleY:1}} transition={{delay:1.8,duration:3}}/>{['Select relevant saved evidence.','Trace the cited sources.','Fresh traffic only when needed.'].map((text,i)=><Reveal key={text} delay={2+i} className="chain-row"><b>[{i+1}]</b><p>{text}</p></Reveal>)}</div>
    <Reveal delay={4.7} className="film-bottom">Grounded in your compilation.</Reveal>
  </Stage>;
}
export function Scene4(){
  return <Stage name="verify" mode="cream"><div className="feature-heading"><small>FROM SIGNAL TO SELLER</small><Reveal delay={.2}><h2>Know what<br/>to <em>verify.</em></h2></Reveal></div>
    <motion.div className="checklist" animate={{rotate:[0,0,-2],scale:[1,1,1.04]}} transition={{duration:6,times:[0,.8,1]}}>
      {['First-party analytics','Matching reporting periods','Customer & revenue records'].map((text,i)=><Reveal key={text} delay={1+i*1.2} className="check-row"><span>0{i+1}</span><h3>{text}</h3><motion.div initial={{scaleX:0}} animate={{scaleX:1}} transition={{delay:1.2+i*1.2,duration:.8}} className="rule"/></Reveal>)}
    </motion.div><Reveal delay={4.3} className="film-bottom">Traffic is context.<br/>Not a buy/no-buy verdict.</Reveal>
  </Stage>;
}
export function Scene5(){
  return <Stage name="brand" mode="lime"><div className="brand-audience">FOR BROKERS & DEAL TEAMS</div>
    <motion.div className="brand-lockup" animate={{scale:[1,1.04,1]}} transition={{duration:6,times:[0,.8,1]}}>
      <h1>{'DealLens'.split('').map((letter,i)=><motion.span key={i} style={{display:'inline-block'}} initial={{opacity:0,rotateX:70,y:15}} animate={{opacity:1,rotateX:0,y:0}} transition={{delay:.4+i*.035,duration:.7}}>{letter}</motion.span>)}</h1>
      <Reveal delay={1.2}><p>Evidence before conviction.</p></Reveal>
      <motion.div className="brand-rule" initial={{scaleX:0}} animate={{scaleX:1}} transition={{delay:1,duration:1}}/>
    </motion.div>
    <Reveal delay={2} className="brand-url">lensdeal.replit.app</Reveal>
    <Reveal delay={3} className="brand-close">Research the traffic.<br/>Ask the right questions.</Reveal>
  </Stage>;
}